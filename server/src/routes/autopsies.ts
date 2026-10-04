import { Router } from "../lib/router.js"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"
import { writeAudit } from "../lib/audit.js"

export const autopsiesRouter = Router()
autopsiesRouter.use(requireAuth, requireRole("pathologist", "public_health_analyst", "system_admin"))

autopsiesRouter.get("/", requireAuth, async (_req, res) => {
  const rows = await query<any[]>(
    `SELECT a.autopsy_id, a.notification_id, a.status, a.final_icd_code, a.final_cause_of_death,
            a.legal_threshold_flag, a.created_at, a.finalized_at,
            u.full_name AS pathologist_name, p.full_name AS patient_name, f.facility_name, f.district
     FROM autopsy_reports a
     JOIN users u ON u.user_id = a.pathologist_id
     JOIN death_notifications dn ON dn.notification_id = a.notification_id
     JOIN patients p ON p.patient_id = dn.patient_id
     JOIN facilities f ON f.facility_id = dn.facility_id
     ORDER BY a.created_at DESC LIMIT 200`,
  )
  res.json({ items: rows })
})

autopsiesRouter.get("/:id", requireAuth, async (req, res) => {
  const rows = await query<any[]>(
    `SELECT a.*, u.full_name AS pathologist_name, p.full_name AS patient_name, p.national_id,
            p.age, p.gender, f.facility_name, f.district, f.province,
            dn.date_of_death, dn.preliminary_icd_code, dn.clinical_summary
     FROM autopsy_reports a
     JOIN users u ON u.user_id = a.pathologist_id
     JOIN death_notifications dn ON dn.notification_id = a.notification_id
     JOIN patients p ON p.patient_id = dn.patient_id
     JOIN facilities f ON f.facility_id = dn.facility_id
     WHERE a.autopsy_id = ?`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: "Autopsy report not found" })
  res.json({ autopsy: rows[0] })
})

autopsiesRouter.patch(
  "/:id/finalize",
  requireAuth,
  requireRole("pathologist", "system_admin"),
  async (req, res) => {
    const rows = await query<any[]>("SELECT autopsy_id, status, notification_id FROM autopsy_reports WHERE autopsy_id = ?", [
      req.params.id,
    ])
    const row = rows[0]
    if (!row) return res.status(404).json({ error: "Autopsy report not found" })
    if (row.status === "finalized") return res.status(409).json({ error: "Already finalized" })

    await query("UPDATE autopsy_reports SET status = 'finalized', finalized_at = NOW() WHERE autopsy_id = ?", [
      req.params.id,
    ])
    await query("UPDATE death_notifications SET status = 'finalized' WHERE notification_id = ?", [row.notification_id])
    await writeAudit(req, {
      action: "finalize_autopsy",
      entityType: "autopsy_reports",
      entityId: req.params.id,
      details: { notificationId: row.notification_id },
    })
    res.json({ ok: true })
  },
)
