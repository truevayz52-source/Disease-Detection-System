import { config } from "../config.js"
import { query } from "../db.js"

export interface CaseInsight {
  objective: "trend" | "outbreak" | "pattern"
  label: string
  text: string
}
export interface CaseInsights {
  caseRef: string
  district: string | null
  category: string
  insights: CaseInsight[]
}

/** Cause precedence shared with the detection passes: finalized autopsy →
 *  medical certification → preliminary code. */
const CAUSE_JOINS = `
  LEFT JOIN (
    SELECT DISTINCT ON (notification_id) notification_id, final_icd_code
    FROM autopsy_reports WHERE status = 'finalized'
    ORDER BY notification_id, finalized_at DESC
  ) ar ON ar.notification_id = dn.notification_id
  LEFT JOIN medical_certifications mc ON mc.notification_id = dn.notification_id`

const bandOf = (age: number) =>
  age < 5 ? { name: "0–4", lo: 0, hi: 5 }
  : age < 18 ? { name: "5–17", lo: 5, hi: 18 }
  : age < 35 ? { name: "18–34", lo: 18, hi: 35 }
  : age < 60 ? { name: "35–59", lo: 35, hi: 60 }
  : { name: "60+", lo: 60, hi: 200 }

/**
 * Rule-based natural-language interpretation for one notification — the
 * "system explains itself after data entry" layer. Generates one bullet per
 * system objective from live aggregates; ~4 queries run in parallel so the
 * endpoint costs roughly a single DB round-trip.
 */
export async function caseInsights(notificationId: string): Promise<CaseInsights | null> {
  const base = await query<any[]>(
    `SELECT dn.notification_id, dn.is_maternal_perinatal, f.district, p.age,
            ic.disease_category AS category, ic.is_notifiable
     FROM death_notifications dn
     JOIN facilities f ON f.facility_id = dn.facility_id
     JOIN patients p ON p.patient_id = dn.patient_id
     ${CAUSE_JOINS}
     JOIN icd_codes ic ON ic.icd_code = COALESCE(ar.final_icd_code, mc.final_icd_code, dn.preliminary_icd_code)
     WHERE dn.notification_id = ?`,
    [notificationId],
  )
  if (!base.length) return null
  const n = base[0]
  const district = n.district ?? "this district"
  const band = n.age == null ? null : bandOf(Number(n.age))

  const [velRows, comboRows, bandRows, alertRows] = await Promise.all([
    // Obj 1 — district mortality velocity: last 7d vs prior 7d
    query<any[]>(
      `SELECT
         COUNT(*) FILTER (WHERE dn.date_of_death >= NOW() - INTERVAL '7 days') AS last7,
         COUNT(*) FILTER (WHERE dn.date_of_death >= NOW() - INTERVAL '14 days'
                          AND dn.date_of_death < NOW() - INTERVAL '7 days') AS prev7
       FROM death_notifications dn JOIN facilities f ON f.facility_id = dn.facility_id
       WHERE f.district = ? AND dn.status <> 'rejected'`,
      [n.district],
    ),
    // Obj 2 — same district+category cluster size in the detection window
    query<any[]>(
      `SELECT COUNT(*) AS c
       FROM death_notifications dn JOIN facilities f ON f.facility_id = dn.facility_id
       ${CAUSE_JOINS}
       JOIN icd_codes ic ON ic.icd_code = COALESCE(ar.final_icd_code, mc.final_icd_code, dn.preliminary_icd_code)
       WHERE f.district = ? AND ic.disease_category = ? AND dn.status <> 'rejected'
         AND GREATEST(dn.date_of_death, dn.created_at) >= NOW() - (? * INTERVAL '1 hour')`,
      [n.district, n.category, config.outbreakWindowHours],
    ),
    // Obj 3 — category share inside the case's age cohort (90 days)
    band
      ? query<any[]>(
          `SELECT COUNT(*) FILTER (WHERE ic.disease_category = ?) AS cat, COUNT(*) AS total
           FROM death_notifications dn
           JOIN facilities f ON f.facility_id = dn.facility_id
           JOIN patients p ON p.patient_id = dn.patient_id
           ${CAUSE_JOINS}
           JOIN icd_codes ic ON ic.icd_code = COALESCE(ar.final_icd_code, mc.final_icd_code, dn.preliminary_icd_code)
           WHERE f.district = ? AND dn.status <> 'rejected'
             AND dn.date_of_death >= NOW() - INTERVAL '90 days'
             AND p.age >= ? AND p.age < ?`,
          [n.category, n.district, band.lo, band.hi],
        )
      : query<any[]>(
          `SELECT COUNT(*) FILTER (WHERE ic.disease_category = ?) AS cat, COUNT(*) AS total
           FROM death_notifications dn
           JOIN facilities f ON f.facility_id = dn.facility_id
           ${CAUSE_JOINS}
           JOIN icd_codes ic ON ic.icd_code = COALESCE(ar.final_icd_code, mc.final_icd_code, dn.preliminary_icd_code)
           WHERE f.district = ? AND dn.status <> 'rejected'
             AND dn.date_of_death >= NOW() - INTERVAL '90 days'`,
          [n.category, n.district],
        ),
    // any active alert on this combo (or MPDSR for this district)
    query<any[]>(
      `SELECT alert_type FROM outbreak_alerts
       WHERE status = 'active' AND district = ?
         AND (disease_category = ? OR disease_category = 'Maternal/Perinatal')`,
      [n.district, n.category],
    ),
  ])

  // — Objective 1: mortality trend prediction —
  const last7 = Number(velRows[0]?.last7 ?? 0)
  const prev7 = Number(velRows[0]?.prev7 ?? 0)
  const delta = prev7 ? Math.round(((last7 - prev7) / prev7) * 100) : last7 ? 100 : 0
  const trendText =
    delta > 0 ? `Weekly mortality velocity in ${district} is up ${delta}% vs the previous 7 days; this case is included in the forecast model.`
    : delta < 0 ? `Weekly mortality velocity in ${district} is down ${Math.abs(delta)}% vs the previous 7 days; this case is included in the forecast model.`
    : `Weekly mortality velocity in ${district} is steady vs the previous 7 days; this case is included in the forecast model.`

  // — Objective 2: early outbreak detection —
  const comboCount = Number(comboRows[0]?.c ?? 0)
  const activeAlert = alertRows[0]?.alert_type as string | undefined
  let outbreakText: string
  if (n.is_maternal_perinatal) {
    outbreakText = `MPDSR instant alert raised for this maternal/perinatal death in ${district} — routed to the maternal review team.`
  } else {
    const threshold = n.is_notifiable ? config.earlyWarningMinCases : config.outbreakThreshold
    const status =
      activeAlert === "outbreak" ? "Outbreak alert active"
      : activeAlert === "early_warning" ? "Early warning active"
      : comboCount >= threshold ? "Warning — at threshold"
      : "Normal"
    outbreakText = `Cluster check: ${comboCount} ${n.category} death(s) in ${district} within the surveillance window (threshold ${threshold}). Status: ${status}.`
  }

  // — Objective 3: cause-of-death pattern recognition —
  const share = Number(bandRows[0]?.total ?? 0)
    ? Math.round((Number(bandRows[0]?.cat ?? 0) / Number(bandRows[0]?.total ?? 1)) * 100)
    : 0
  const cohort = band ? `in the ${band.name} cohort ` : ""
  const patternText = `${n.category} now accounts for ${share}% of recorded deaths ${cohort}in ${district} over the last 90 days.`

  return {
    caseRef: n.notification_id,
    district: n.district,
    category: n.category,
    insights: [
      { objective: "trend", label: "Trend impact (Objective 1)", text: trendText },
      { objective: "outbreak", label: "Outbreak status (Objective 2)", text: outbreakText },
      { objective: "pattern", label: "Pattern recognition (Objective 3)", text: patternText },
    ],
  }
}
