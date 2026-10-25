import { config } from "../config.js"
import { newId, query } from "../db.js"
import { callPython } from "./analyticsClient.js"
import { notifyUser } from "../routes/notifications-realtime.js"
import { emailConfigured, sendEmail } from "./email.js"

/**
 * Threshold cluster detection (Ch 4.4 step 4–5, TC-04). Groups death
 * notifications by disease category + district inside a rolling time window;
 * crossing OUTBREAK_THRESHOLD produces an outbreak_alerts row with a risk
 * score. Maternal/perinatal notifications generate MPDSR alerts immediately.
 * This is the always-on fallback for the Python ML service — the system keeps
 * detecting outbreaks even when analytics/ is offline (Ch 5.3 resilience).
 */
export async function detectOutbreaks(windowHours = config.outbreakWindowHours) {
  const rules = await query<any[]>("SELECT * FROM alert_thresholds WHERE is_active ORDER BY created_at DESC")
  const clusters: any[] = []
  for (const rule of [...rules, { district: null, disease_category: null, case_threshold: config.outbreakThreshold, time_window_hours: windowHours, default: true }]) {
  const found = await query<any[]>(
    `SELECT f.district, ic.disease_category AS category, COUNT(*) AS case_count,
            BOOL_OR(ic.is_notifiable) AS notifiable,
            MIN(dn.date_of_death) AS first_death, MAX(dn.date_of_death) AS last_death
     FROM death_notifications dn
     JOIN facilities f ON f.facility_id = dn.facility_id
     LEFT JOIN (
       SELECT DISTINCT ON (notification_id) notification_id, final_icd_code
       FROM autopsy_reports
       WHERE status = 'finalized'
       ORDER BY notification_id, finalized_at DESC
     ) ar ON ar.notification_id = dn.notification_id
     JOIN icd_codes ic ON ic.icd_code = COALESCE(ar.final_icd_code, dn.preliminary_icd_code)
     WHERE dn.status <> 'rejected'
       AND dn.date_of_death >= NOW() - (? * INTERVAL '1 hour') AND dn.date_of_death <= NOW()
       AND (?::text IS NULL OR f.district=?) AND (?::text IS NULL OR ic.disease_category=?)
     GROUP BY f.district, ic.disease_category
     HAVING COUNT(*) >= ?`,
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
        // Outbreak alerts are pushed via websocket/inbox and, when SMTP is configured, email.
        emailConfigured() ? "websocket,email,audit-log" : "websocket,audit-log",
      ],
    )
    created.push({ alertId, district: c.district, category: c.category, caseCount: c.case_count, riskScore })
    const recipients = await query<any[]>("SELECT user_id, email FROM users WHERE status='active' AND role IN ('public_health_analyst','system_admin','executive')")
    for (const recipient of recipients) {
      await notifyUser(recipient.user_id,"Outbreak threshold reached",`${c.district}: ${c.case_count} reported deaths in ${c.category}.`,"/alerts","outbreak")
      if (recipient.email && emailConfigured()) {
        void sendEmail(recipient.email, "DDS outbreak alert", `${c.district}: ${c.case_count} reported deaths in ${c.category}. Open the dashboard for details.`).catch(() => {})
      }
    }
  }

  // --- Low-volume early warning (Ch 5.5) -----------------------------------
  // Cumulative: flags a district+category when its notifiable count reaches
  // config.earlyWarningMinCases within the early-warning window, or when the
  // Python Poisson CUSUM flags a persistent low-volume anomaly. No time gate
  // between entries — spacing does not matter. Maternal/Perinatal is skipped
  // (MPDSR instant-alerts those) and combos already covered by an active
  // alert never refire.
  const ewRows = await query<any[]>(
    `SELECT f.district, ic.disease_category AS category, ic.is_notifiable,
            COUNT(*) AS total,
            TO_CHAR(date_trunc('day', dn.date_of_death), 'YYYY-MM-DD') AS day,
            COUNT(*) AS day_count
     FROM death_notifications dn
     JOIN facilities f ON f.facility_id = dn.facility_id
     LEFT JOIN (
       SELECT DISTINCT ON (notification_id) notification_id, final_icd_code
       FROM autopsy_reports
       WHERE status = 'finalized'
       ORDER BY notification_id, finalized_at DESC
     ) ar ON ar.notification_id = dn.notification_id
     JOIN icd_codes ic ON ic.icd_code = COALESCE(ar.final_icd_code, dn.preliminary_icd_code)
     WHERE dn.status <> 'rejected'
       AND dn.date_of_death >= NOW() - (? * INTERVAL '1 hour')
       AND ic.disease_category NOT IN ('Maternal','Perinatal')
     GROUP BY f.district, ic.disease_category, ic.is_notifiable, day`,
    [config.earlyWarningWindowHours],
  )

  const combos = new Map<string, { district: string; category: string; notifiable: boolean; total: number; days: Map<string, number> }>()
  for (const r of ewRows) {
    const key = `${r.district}||${r.category}`
    if (!combos.has(key)) combos.set(key, { district: r.district, category: r.category, notifiable: !!r.is_notifiable, total: 0, days: new Map() })
    const c = combos.get(key)!
    c.total += Number(r.day_count)
    c.days.set(r.day, Number(r.day_count))
  }

  const EW_SERIES_DAYS = 14
  const dayLabels = Array.from({ length: EW_SERIES_DAYS }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (EW_SERIES_DAYS - 1 - i))
    return d.toISOString().slice(0, 10)
  })
  const cusumInput = [...combos.values()].map((c) => ({
    district: c.district,
    category: c.category,
    counts: dayLabels.map((l) => c.days.get(l) ?? 0),
  }))
  const cusumResult = await callPython<{ anomalies: { district: string; category: string; cusum: number }[] }>(
    "/cusum",
    { series: cusumInput, limit: config.cusumLimit },
  )
  const cusumFlags = new Map((cusumResult?.anomalies ?? []).map((a) => [`${a.district}||${a.category}`, a.cusum]))

  const activeAlerts = await query<any[]>(
    "SELECT district, disease_category FROM outbreak_alerts WHERE status = 'active'",
  )
  const covered = new Set(activeAlerts.map((a) => `${a.district}||${a.disease_category}`))

  const ewRecipients = await query<any[]>(
    "SELECT user_id, email FROM users WHERE status='active' AND role IN ('public_health_analyst','system_admin','executive')",
  )

  for (const [key, c] of combos) {
    if (covered.has(key)) continue
    const cusumHit = cusumFlags.get(key)
    const ruleHit = c.notifiable && c.total >= config.earlyWarningMinCases
    if (!ruleHit && cusumHit === undefined) continue

    const detection = ruleHit ? "notifiable-minimum" : "cusum"
    const alertId = newId("alt")
    await query(
      `INSERT INTO outbreak_alerts
       (alert_id, disease_category, district, cluster_data, case_count, risk_score, alert_type, dispatched_channels)
       VALUES (?, ?, ?, ?, ?, ?, 'early_warning', ?)`,
      [
        alertId,
        c.category,
        c.district,
        JSON.stringify({ detection, count: c.total, window_hours: config.earlyWarningWindowHours, ...(cusumHit !== undefined ? { cusum: cusumHit } : {}) }),
        c.total,
        config.earlyWarningRiskScore,
        emailConfigured() ? "websocket,email,audit-log" : "websocket,audit-log",
      ],
    )
    created.push({ alertId, district: c.district, category: c.category, caseCount: c.total, riskScore: config.earlyWarningRiskScore, earlyWarning: true })
    for (const recipient of ewRecipients) {
      await notifyUser(recipient.user_id, "Early warning raised", `${c.district}: ${c.total} reported death(s) in ${c.category} (${detection}).`, "/alerts", "outbreak")
      if (recipient.email && emailConfigured()) {
        void sendEmail(recipient.email, "DDS early warning", `${c.district}: ${c.total} reported death(s) in ${c.category} (${detection}). Open the dashboard for details.`).catch(() => {})
      }
    }
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
     WHERE dn.notification_id = ? AND dn.is_maternal_perinatal`,
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
      emailConfigured() ? "websocket,email,audit-log" : "websocket,audit-log",
    ],
  )
  return alertId
}
