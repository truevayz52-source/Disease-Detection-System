import { Router } from "../lib/router.js"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"
import { writeAudit } from "../lib/audit.js"
import { signReport, verifyReport } from "../lib/signature.js"
import { config } from "../config.js"
import { notifyUser } from "./notifications-realtime.js"

export const autopsiesRouter = Router()
autopsiesRouter.use(requireAuth, requireRole("pathologist", "public_health_analyst"))

autopsiesRouter.get("/", requireAuth, async (_req, res) => {
  const rows = await query<any[]>(
    `SELECT a.autopsy_id, a.notification_id, a.status, a.final_icd_code, a.final_cause_of_death,
            a.legal_threshold_flag, a.digital_signature, a.signature_hmac, a.created_at, a.updated_at, a.finalized_at,
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
  requireRole("pathologist"),
  async (req, res) => {
    const rows = await query<any[]>(
      `SELECT a.autopsy_id, a.status, a.notification_id, a.pathologist_id, a.final_icd_code,
              a.final_cause_of_death, a.digital_signature, a.signature_hmac,
              dn.reported_by
       FROM autopsy_reports a
       JOIN death_notifications dn ON dn.notification_id = a.notification_id
       WHERE a.autopsy_id = ?`,
      [req.params.id],
    )
    const row = rows[0]
    if (!row) return res.status(404).json({ error: "Autopsy report not found" })
    if (row.status === "finalized") return res.status(409).json({ error: "Already finalized" })
    if (row.pathologist_id !== req.user!.userId) return res.status(403).json({ error: "Only the authoring pathologist may finalize this report" })

    const finalizedAt = new Date()
    const signatureHmac = signReport(
      {
        type: "autopsy_report",
        autopsyId: row.autopsy_id,
        notificationId: row.notification_id,
        pathologistId: row.pathologist_id,
        finalIcdCode: row.final_icd_code,
        finalCauseOfDeath: row.final_cause_of_death,
        digitalSignature: row.digital_signature,
        finalizedAt: finalizedAt.toISOString(),
      },
      config.signatureHmacKey,
    )

    await query(
      "UPDATE autopsy_reports SET status = 'finalized', finalized_at = ?, signature_hmac = ? WHERE autopsy_id = ?",
      [finalizedAt, signatureHmac, req.params.id],
    )
    await query("UPDATE death_notifications SET status = 'finalized' WHERE notification_id = ?", [row.notification_id])
    await writeAudit(req, {
      action: "finalize_autopsy",
      entityType: "autopsy_reports",
      entityId: req.params.id,
      details: { notificationId: row.notification_id },
    })
    await notifyUser(row.reported_by, "Autopsy finalized", `Case ${row.notification_id} has been finalized.`, `/notifications/${row.notification_id}`, "autopsy")
    res.json({ ok: true })
  },
)

autopsiesRouter.get(
  "/:id/verify",
  requireAuth,
  requireRole("pathologist", "public_health_analyst"),
  async (req, res) => {
    const [row] = await query<any[]>(
      `SELECT a.autopsy_id, a.notification_id, a.pathologist_id, a.final_icd_code,
              a.final_cause_of_death, a.digital_signature, a.signature_hmac, a.finalized_at
       FROM autopsy_reports a WHERE a.autopsy_id = ?`,
      [req.params.id],
    )
    if (!row) return res.status(404).json({ error: "Autopsy report not found" })
    if (row.status !== "finalized") return res.status(409).json({ error: "Only finalized reports can be verified" })
    const payload = {
      type: "autopsy_report",
      autopsyId: row.autopsy_id,
      notificationId: row.notification_id,
      pathologistId: row.pathologist_id,
      finalIcdCode: row.final_icd_code,
      finalCauseOfDeath: row.final_cause_of_death,
      digitalSignature: row.digital_signature,
      finalizedAt: row.finalized_at instanceof Date ? row.finalized_at.toISOString() : row.finalized_at,
    }
    const { valid, reason } = verifyReport(payload, row.signature_hmac, config.signatureHmacKey)
    res.json({
      valid,
      reason,
      algorithm: "HMAC-SHA256",
      fingerprint: row.signature_hmac ? `${row.signature_hmac.slice(0, 16)}…` : null,
    })
  },
)
