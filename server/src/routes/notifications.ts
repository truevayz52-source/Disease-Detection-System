import { createNotification } from "../lib/notification-service.js"
import { Router } from "../lib/router.js"
import { canAccessNotification, facilityScoped } from "../lib/access.js"
import crypto from "node:crypto"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { newId, query } from "../db.js"
import { writeAudit } from "../lib/audit.js"
import { checkMpdsr, detectOutbreaks } from "../lib/outbreak.js"

export const notificationsRouter = Router()
notificationsRouter.use(requireAuth, requireRole("medical_officer", "mortuary_clerk", "pathologist", "public_health_analyst", "system_admin"))

const LIST_SELECT = `
  SELECT dn.notification_id, dn.date_of_death, dn.preliminary_icd_code, dn.clinical_summary,
         dn.status, dn.is_maternal_perinatal, dn.created_at,
         p.patient_id, p.full_name AS patient_name, p.national_id, p.age, p.gender,
         p.residential_address, p.latitude AS patient_lat, p.longitude AS patient_lng,
         f.facility_id, f.facility_name, f.district, f.province,
         ic.description AS icd_description, ic.disease_category,
         u.full_name AS reported_by_name
  FROM death_notifications dn
  JOIN patients p ON p.patient_id = dn.patient_id
  JOIN facilities f ON f.facility_id = dn.facility_id
  JOIN icd_codes ic ON ic.icd_code = dn.preliminary_icd_code
  JOIN users u ON u.user_id = dn.reported_by`

// Death notifications (Ch 4.2 input, Ch 4.4 step 1).
notificationsRouter.get("/", requireAuth, async (req, res) => {
  const where: string[] = []
  const params: any[] = []
  // Medical officers see only their own facility's submissions (RBAC scoping).
  if (facilityScoped(req.user!)) {
    if (req.user!.facilityId) {
      where.push("dn.facility_id = ?")
      params.push(req.user!.facilityId)
    } else {
      where.push("1 = 0")
    }
  }
  if (req.query.status) {
    where.push("dn.status = ?")
    params.push(String(req.query.status))
  }
  if (req.query.district) {
    where.push("f.district = ?")
    params.push(String(req.query.district))
  }
  if (req.query.icd) {
    where.push("dn.preliminary_icd_code = ?")
    params.push(String(req.query.icd))
  }
  if (req.query.q) {
    where.push("(p.full_name LIKE ? OR p.national_id LIKE ?)")
    const like = `%${String(req.query.q)}%`
    params.push(like, like)
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : ""
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 200))
  const rows = await query<any[]>(`${LIST_SELECT} ${whereSql} ORDER BY dn.date_of_death DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize])
  const [countRow] = await query<any[]>(
    `SELECT COUNT(*) AS total FROM death_notifications dn
     JOIN patients p ON p.patient_id = dn.patient_id
     JOIN facilities f ON f.facility_id = dn.facility_id ${whereSql}`,
    params,
  )
  res.json({ items: rows.map(row => req.user!.role === "mortuary_clerk" ? { ...row, clinical_summary: null } : row), total: Number(countRow?.total ?? 0), page, pageSize })
})

notificationsRouter.post("/", requireAuth, async (req,res) => { res.status(201).json(await createNotification(req,req.body)) })

notificationsRouter.get("/:id", requireAuth, async (req, res) => {
  if (!await canAccessNotification(req.user!, req.params.id)) return res.status(403).json({ error: "Record unavailable" })
  const rows = await query<any[]>(`${LIST_SELECT} WHERE dn.notification_id = ?`, [req.params.id])
  const row = rows[0]
  if (!row) return res.status(404).json({ error: "Notification not found" })
  if (facilityScoped(req.user!) && req.user!.facilityId && row.facility_id !== req.user!.facilityId) {
    return res.status(403).json({ error: "Forbidden: different facility" })
  }
  if (req.user!.role === "mortuary_clerk") return res.json({ notification: { ...row, clinical_summary: null }, images: [], autopsy: null })
  const images = await query<any[]>(
    `SELECT image_id, mime_type, resolution, file_hash, original_size_bytes, compressed_size_bytes,
            compressed, uploaded_timestamp FROM tele_pathology_images WHERE notification_id = ?`,
    [req.params.id],
  )
  const autopsy = await query<any[]>(
    `SELECT a.autopsy_id, a.status, a.final_icd_code, a.final_cause_of_death, a.legal_threshold_flag,
            a.digital_signature, a.finalized_at, u.full_name AS pathologist_name
     FROM autopsy_reports a JOIN users u ON u.user_id = a.pathologist_id WHERE a.notification_id = ?`,
    [req.params.id],
  )
  res.json({ notification: row, images, autopsy: autopsy[0] ?? null })
})

const patchSchema = z.object({
  status: z.enum(["pending_review", "under_review", "autopsy_complete", "finalized"]).optional(),
  clinicalSummary: z.string().max(8000).optional(),
})

const autopsySchema = z.object({
  internalObservations: z.string().max(16000).optional().nullable(),
  toxicologyResults: z.string().max(16000).optional().nullable(),
  legalThresholdFlag: z.boolean().default(false),
  finalIcdCode: z.string().min(1),
  finalCauseOfDeath: z.string().min(2).max(512),
  digitalSignature: z.string().min(2).max(255),
  finalize: z.boolean().default(false),
})

// Pathologists record post-mortem findings and sign the final cause (Ch 4.4 step 3).
notificationsRouter.post(
  "/:id/autopsy",
  requireAuth,
  requireRole("pathologist", "system_admin"),
  async (req, res) => {
    const parsed = autopsySchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "Invalid autopsy data", issues: parsed.error.issues })
    const d = parsed.data

    const notif = await query<any[]>("SELECT notification_id, status FROM death_notifications WHERE notification_id = ?", [
      req.params.id,
    ])
    if (!notif.length) return res.status(404).json({ error: "Notification not found" })
    const icd = await query<any[]>("SELECT icd_code FROM icd_codes WHERE icd_code = ?", [d.finalIcdCode])
    if (!icd.length) return res.status(400).json({ error: "Unknown final ICD code" })
    const dup = await query<any[]>("SELECT autopsy_id FROM autopsy_reports WHERE notification_id = ?", [req.params.id])
    if (dup.length) return res.status(409).json({ error: "Autopsy already exists for this notification" })

    const autopsyId = newId("aut")
    const auditHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ autopsyId, notificationId: req.params.id, d, pathologist: req.user!.userId }))
      .digest("hex")
    const status = d.finalize ? "finalized" : "draft"

    await query(
      `INSERT INTO autopsy_reports
       (autopsy_id, notification_id, pathologist_id, internal_observations, toxicology_results,
        legal_threshold_flag, final_icd_code, final_cause_of_death, digital_signature, audit_hash, status, finalized_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        autopsyId,
        req.params.id,
        req.user!.userId,
        d.internalObservations ?? null,
        d.toxicologyResults ?? null,
        d.legalThresholdFlag,
        d.finalIcdCode,
        d.finalCauseOfDeath,
        d.digitalSignature,
        auditHash,
        status,
        d.finalize ? new Date() : null,
      ],
    )
    await query("UPDATE death_notifications SET status = ? WHERE notification_id = ?", [
      d.finalize ? "finalized" : "autopsy_complete",
      req.params.id,
    ])
    await writeAudit(req, {
      action: d.finalize ? "finalize_autopsy" : "create_autopsy",
      entityType: "autopsy_reports",
      entityId: autopsyId,
      details: { notificationId: req.params.id, finalIcd: d.finalIcdCode, legalThreshold: d.legalThresholdFlag },
    })
    res.status(201).json({ autopsyId, status })
  },
)

notificationsRouter.patch(
  "/:id",
  requireAuth,
  requireRole("medical_officer", "public_health_analyst", "system_admin"),
  async (req, res) => {
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "Invalid update" })
    const d = parsed.data
    if (!await canAccessNotification(req.user!, req.params.id) || req.user!.role === "mortuary_clerk") return res.status(403).json({ error: "Forbidden" })
    if (!d.status && d.clinicalSummary === undefined) return res.status(400).json({ error: "Nothing to update" })

    const sets: string[] = []
    const params: any[] = []
    if (d.status) {
      sets.push("status = ?")
      params.push(d.status)
    }
    if (d.clinicalSummary !== undefined) {
      sets.push("clinical_summary = ?")
      params.push(d.clinicalSummary)
    }
    params.push(req.params.id)
    const result = await query<any>(`UPDATE death_notifications SET ${sets.join(", ")} WHERE notification_id = ?`, params)
    if (!result.affectedRows) return res.status(404).json({ error: "Notification not found" })
    await writeAudit(req, {
      action: "update_death_notification",
      entityType: "death_notifications",
      entityId: req.params.id,
      details: d,
    })
    res.json({ ok: true })
  },
)
