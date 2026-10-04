import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"
import { writeAudit } from "../lib/audit.js"

export const bulletinRouter = Router()

// Generate automated epidemiological bulletin
bulletinRouter.post("/generate", requireAuth, requireRole("public_health_analyst", "system_admin"), async (req, res) => {
  const schema = z.object({
    type: z.enum(["daily", "weekly", "monthly"]),
    district: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid bulletin parameters" })
  
  const { type, district, startDate, endDate } = parsed.data
  
  // Aggregate case data
  const cases = await query<any[]>(
    `SELECT 
      dn.notification_id,
      dn.date_of_death,
      f.district,
      f.province,
      ic.disease_category,
      ic.description as disease_name,
      p.gender,
      p.age,
      dn.status
     FROM death_notifications dn
     JOIN patients p ON p.patient_id = dn.patient_id
     JOIN facilities f ON f.facility_id = dn.facility_id
     JOIN icd_codes ic ON ic.icd_code = dn.preliminary_icd_code
     WHERE ${district ? 'f.district = ?' : '1=1'}
     ${startDate ? 'AND dn.date_of_death >= ?' : ''}
     ${endDate ? 'AND dn.date_of_death <= ?' : ''}
     ORDER BY dn.date_of_death DESC`,
    district ? [district, startDate, endDate].filter(Boolean) : [startDate, endDate].filter(Boolean)
  )
  
  // Get outbreak alerts
  const alerts = await query<any[]>(
    `SELECT * FROM outbreak_alerts
     WHERE ${district ? 'district = ?' : '1=1'}
     AND triggered_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
     ORDER BY triggered_date DESC`,
    district ? [district] : []
  )
  
  // Generate summary statistics
  const totalCases = cases.length
  const byDisease: Record<string, number> = {}
  const byDistrict: Record<string, number> = {}
  
  for (const c of cases) {
    byDisease[c.disease_category] = (byDisease[c.disease_category] || 0) + 1
    byDistrict[c.district] = (byDistrict[c.district] || 0) + 1
  }
  
  const bulletin = {
    id: crypto.randomUUID(),
    type,
    generatedAt: new Date(),
    period: { start: startDate || "Not specified", end: endDate || "Not specified" },
    district: district || "All Districts",
    summary: {
      totalCases,
      activeAlerts: alerts.filter((a: any) => a.status === "active").length,
      resolvedAlerts: alerts.filter((a: any) => a.status === "resolved").length,
    },
    byDisease,
    byDistrict,
    alerts,
    cases: cases.slice(0, 50), // Limit to first 50 cases
  }
  
  // Save bulletin record
  await query(
    `INSERT INTO scheduled_reports (report_id, created_by, report_name, report_type, schedule_config, recipients, last_run_at, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [bulletin.id, req.user!.userId, `${type.charAt(0).toUpperCase() + type.slice(1)} Bulletin ${district || 'National'}`, 
     type, JSON.stringify(bulletin), JSON.stringify([]), new Date(), false]
  )
  
  await writeAudit(req, { action: "generate_bulletin", entityType: "scheduled_reports", entityId: bulletin.id, details: { type, district } })
  res.json({ bulletin })
})

// Get saved bulletins
bulletinRouter.get("/saved", requireAuth, requireRole("public_health_analyst", "system_admin", "executive"), async (req, res) => {
  const bulletins = await query<any[]>(
    `SELECT report_id, report_name, report_type, schedule_config, last_run_at, created_at
     FROM scheduled_reports
     WHERE report_type IN ('daily', 'weekly', 'monthly')
     ORDER BY last_run_at DESC
     LIMIT 50`
  )
  res.json({ items: bulletins })
})
