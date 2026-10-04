import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"
import { writeAudit } from "../lib/audit.js"

export const outbreakDynamicRouter = Router()

// Dynamic outbreak threshold engine with CUSUM and moving averages
outbreakDynamicRouter.get("/thresholds", requireAuth, requireRole("public_health_analyst", "system_admin"), async (_req, res) => {
  const thresholds = await query<any[]>(
    `SELECT * FROM alert_thresholds WHERE is_active = true ORDER BY created_at DESC`
  )
  res.json({ items: thresholds })
})

outbreakDynamicRouter.post("/thresholds", requireAuth, requireRole("public_health_analyst", "system_admin"), async (req, res) => {
  const schema = z.object({
    district: z.string().optional(),
    diseaseCategory: z.string().optional(),
    caseThreshold: z.number().min(1),
    timeWindowHours: z.number().min(1),
    spatialRadiusKm: z.number().optional(),
    alertPriority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid threshold configuration" })
  
  const { district, diseaseCategory, caseThreshold, timeWindowHours, spatialRadiusKm, alertPriority } = parsed.data
  
  const thresholdId = crypto.randomUUID()
  await query(
    `INSERT INTO alert_thresholds (threshold_id, configured_by, district, disease_category, case_threshold, time_window_hours, spatial_radius_km, alert_priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [thresholdId, req.user!.userId, district || null, diseaseCategory || null, caseThreshold, timeWindowHours, spatialRadiusKm || null, alertPriority]
  )
  
  await writeAudit(req, { action: "create_threshold", entityType: "alert_thresholds", entityId: thresholdId, details: parsed.data })
  res.status(201).json({ thresholdId })
})

// CUSUM-based dynamic outbreak detection
outbreakDynamicRouter.post("/detect-dynamic", requireAuth, requireRole("public_health_analyst", "system_admin"), async (req, res) => {
  const schema = z.object({
    district: z.string(),
    diseaseCategory: z.string(),
    windowDays: z.number().default(7),
    cusumThreshold: z.number().default(3),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid detection parameters" })
  
  const { district, diseaseCategory, windowDays, cusumThreshold } = parsed.data
  
  // Calculate baseline statistics — exclude the window under test so an
  // active outbreak doesn't inflate its own baseline and suppress the signal.
  const baselineRows = await query<any[]>(
    `SELECT COUNT(*) as case_count, DATE(date_of_death) as death_date
     FROM death_notifications dn
     JOIN patients p ON p.patient_id = dn.patient_id
     JOIN facilities f ON f.facility_id = dn.facility_id
     JOIN icd_codes ic ON ic.icd_code = dn.preliminary_icd_code
     WHERE f.district = ? AND ic.disease_category = ?
     AND dn.date_of_death >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     AND dn.date_of_death < DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(date_of_death)
     ORDER BY death_date`,
    [district, diseaseCategory, windowDays * 2, windowDays]
  )
  
  const baselineCases = baselineRows.map(r => r.case_count)
  const meanBaseline = baselineCases.length > 0 ? baselineCases.reduce((a, b) => a + b, 0) / baselineCases.length : 0
  const stdBaseline = baselineCases.length > 1 ? Math.sqrt(baselineCases.reduce((sq, n) => sq + Math.pow(n - meanBaseline, 2), 0) / (baselineCases.length - 1)) : 0
  
  // Calculate recent cases for CUSUM
  const recentRows = await query<any[]>(
    `SELECT COUNT(*) as case_count, DATE(date_of_death) as death_date
     FROM death_notifications dn
     JOIN patients p ON p.patient_id = dn.patient_id
     JOIN facilities f ON f.facility_id = dn.facility_id
     JOIN icd_codes ic ON ic.icd_code = dn.preliminary_icd_code
     WHERE f.district = ? AND ic.disease_category = ?
     AND dn.date_of_death >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(date_of_death)
     ORDER BY death_date`,
    [district, diseaseCategory, windowDays]
  )
  
  let cusum = 0
  const cusumHistory = []
  for (const row of recentRows) {
    const zScore = stdBaseline > 0 ? (row.case_count - meanBaseline) / stdBaseline : 0
    cusum = Math.max(0, cusum + zScore)
    cusumHistory.push({ date: row.death_date, cases: row.case_count, cusum, threshold: cusumThreshold })
  }
  
  const isOutbreak = cusum >= cusumThreshold
  
  if (isOutbreak) {
    // Create outbreak alert
    const alertId = crypto.randomUUID()
    await query(
      `INSERT INTO outbreak_alerts (alert_id, disease_category, district, cluster_data, case_count, risk_score, alert_type, triggered_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [alertId, diseaseCategory, district, JSON.stringify({ method: "CUSUM", threshold: cusumThreshold, current: cusum }), 
       recentRows.reduce((sum, r) => sum + r.case_count, 0), cusum, "outbreak", new Date(), "active"]
    )
  }
  
  res.json({
    outbreakDetected: isOutbreak,
    baseline: { mean: meanBaseline, std: stdBaseline },
    cusumHistory,
    currentCUSUM: cusum,
    threshold: cusumThreshold,
  })
})

// Instant alert for high-risk diseases
outbreakDynamicRouter.post("/instant-alert", requireAuth, requireRole("medical_officer", "public_health_analyst", "system_admin"), async (req, res) => {
  const schema = z.object({
    notificationId: z.string(),
    diseaseCode: z.string(),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid parameters" })
  
  const { notificationId, diseaseCode } = parsed.data
  
  // High-risk diseases that trigger instant alerts
  const HIGH_RISK_DISEASES = ["A00", "A95", "A90", "A01", "U07.1"] // Cholera, Yellow Fever, Dengue, Typhoid, COVID-19
  
  if (HIGH_RISK_DISEASES.includes(diseaseCode)) {
    const alertId = crypto.randomUUID()
    await query(
      `INSERT INTO outbreak_alerts (alert_id, disease_category, district, cluster_data, case_count, risk_score, alert_type, triggered_date, status)
       SELECT ?, ic.disease_category, f.district, ?, 1, 1.0, 'instant_alert', NOW(), 'active'
       FROM death_notifications dn
       JOIN facilities f ON f.facility_id = dn.facility_id
       JOIN icd_codes ic ON ic.icd_code = dn.preliminary_icd_code
       WHERE dn.notification_id = ?`,
      [alertId, JSON.stringify({ instant_trigger: true, disease_code: diseaseCode }), notificationId]
    )
    
    await writeAudit(req, { action: "instant_alert", entityType: "outbreak_alerts", entityId: alertId, details: { diseaseCode, notificationId } })
  }
  
  res.json({ ok: true })
})
