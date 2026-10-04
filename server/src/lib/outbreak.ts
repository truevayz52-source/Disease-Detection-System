import { config } from "../config.js"
import { newId, query } from "../db.js"
import { notifyUser } from "../routes/notifications-realtime.js"

/**
 * Threshold cluster detection (Ch 4.4 step 4–5, TC-04). Groups death
 * notifications by disease category + district inside a rolling time window;
 * crossing OUTBREAK_THRESHOLD produces an outbreak_alerts row with a risk
 * score. Maternal/perinatal notifications generate MPDSR alerts immediately.
 * This is the always-on fallback for the Python ML service — the system keeps
 * detecting outbreaks even when analytics/ is offline (Ch 5.3 resilience).
 */
export async function detectOutbreaks(windowHours = config.outbreakWindowHours) {
  const rules = await query<any[]>("SELECT * FROM alert_thresholds WHERE is_active=1 ORDER BY created_at DESC")
  const clusters: any[] = []
  for (const rule of [...rules, { district: null, disease_category: null, case_threshold: config.outbreakThreshold, time_window_hours: windowHours, default: true }]) {
  const found = await query<any[]>(
    `SELECT f.district, ic.disease_category AS category, COUNT(*) AS case_count,
            MAX(ic.is_notifiable) AS notifiable,
            MIN(dn.date_of_death) AS first_death, MAX(dn.date_of_death) AS last_death
     FROM death_notifications dn
     JOIN facilities f ON f.facility_id = dn.facility_id
     JOIN icd_codes ic ON ic.icd_code = dn.preliminary_icd_code
     WHERE dn.date_of_death >= DATE_SUB(NOW(), INTERVAL ? HOUR) AND dn.date_of_death <= NOW()
       AND (? IS NULL OR f.district=?) AND (? IS NULL OR ic.disease_category=?)
     GROUP BY f.district, ic.disease_category
     HAVING case_count >= ?`,
    [rule.time_window_hours, rule.district, rule.district, rule.disease_category, rule.disease_category, rule.case_threshold],
  )
  for (const c of found) {
    const matching = rules.find(r => (!r.district || r.district === c.district) && (!r.disease_category || r.disease_category === c.category))
    if (rule.default && matching) continue
    if (!rule.default && matching?.threshold_id !== rule.threshold_id) continue
    clusters.push({...c,windowHours:rule.time_window_hours,thresholdId:rule.threshold_id??null})
  }
  }

  const created: any[] = []
  for (const c of clusters) {
    // Skip if an active alert already covers this district+category.
    const existing = await query<any[]>(
      `SELECT alert_id FROM outbreak_alerts
       WHERE status = 'active' AND district = ? AND disease_category = ? AND alert_type = 'outbreak'`,
      [c.district, c.category],
    )
    if (existing.length) continue

    const alertId = newId("alt")
    const riskScore = Math.min(100, 40 + c.case_count * 4 + (c.notifiable ? 15 : 0))
    await query(
      `INSERT INTO outbreak_alerts
       (alert_id, disease_category, district, cluster_data, case_count, risk_score, alert_type, dispatched_channels)
       VALUES (?, ?, ?, ?, ?, ?, 'outbreak', ?)`,
      [
        alertId,
        c.category,
        c.district,
        JSON.stringify({
          window_hours: c.windowHours,
          threshold_id: c.thresholdId,
          first_death: c.first_death,
          last_death: c.last_death,
          detection: "node-threshold",
        }),
        c.case_count,
        riskScore,
        // Channel dispatch is a logged stub — no real SMS/email gateway (Ch 5.5).
        "dashboard,audit-log",
      ],
    )
    created.push({ alertId, district: c.district, category: c.category, caseCount: c.case_count, riskScore })
    const recipients = await query<any[]>("SELECT user_id FROM users WHERE status='active' AND role IN ('public_health_analyst','system_admin','executive')")
    for (const recipient of recipients) await notifyUser(recipient.user_id,"Outbreak threshold reached",`${c.district}: ${c.case_count} reported deaths in ${c.category}.`,"/alerts","outbreak")
  }
  return created
}

/**
 * Coalesced variant for hot paths (notification intake, offline-sync replay).
 * The first call runs immediately and returns real results; calls inside the
 * cooldown fold into one trailing run whose callers resolve to [] — created
 * alerts still reach users through notifyUser websocket pushes. Without this,
 * a 20-item offline sync would run 20 full scans back-to-back.
 */
let outbreakCooldownUntil = 0
let outbreakTimer: ReturnType<typeof setTimeout> | null = null
export function detectOutbreaksCoalesced(windowHours = config.outbreakWindowHours) {
  const now = Date.now()
  if (now >= outbreakCooldownUntil) {
    outbreakCooldownUntil = now + 2000
    return detectOutbreaks(windowHours)
  }
  if (!outbreakTimer) {
    outbreakTimer = setTimeout(() => {
      outbreakTimer = null
      void detectOutbreaks().catch(() => [])
    }, Math.max(0, outbreakCooldownUntil - now))
    outbreakTimer.unref()
  }
  return Promise.resolve([] as Awaited<ReturnType<typeof detectOutbreaks>>)
}

/** MPDSR flag check — fires immediately on each maternal/perinatal notification. */
export async function checkMpdsr(notificationId: string) {
  const rows = await query<any[]>(
    `SELECT dn.notification_id, f.district, f.facility_name
     FROM death_notifications dn JOIN facilities f ON f.facility_id = dn.facility_id
     WHERE dn.notification_id = ? AND dn.is_maternal_perinatal = 1`,
    [notificationId],
  )
  if (!rows.length) return null
  const n = rows[0]
  const alertId = newId("alt")
  await query(
    `INSERT INTO outbreak_alerts
     (alert_id, disease_category, district, cluster_data, case_count, risk_score, alert_type, dispatched_channels)
     VALUES (?, 'Maternal/Perinatal', ?, ?, 1, 85, 'mpdsr', ?)`,
    [
      alertId,
      n.district,
      JSON.stringify({ notification_id: n.notification_id, facility: n.facility_name }),
      "dashboard,audit-log",
    ],
  )
  return alertId
}
