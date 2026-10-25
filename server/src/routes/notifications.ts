import { createNotification } from "../lib/notification-service.js"
import { Router } from "../lib/router.js"
import { canAccessNotification, facilityScoped } from "../lib/access.js"
import {
  assertCaseOpen,
  canTransition,
  isCaseStatus,
  isTerminal,
  reviewSlaHours,
  type CaseStatus,
} from "../lib/case-workflow.js"
import { signReport } from "../lib/signature.js"
import { config } from "../config.js"
import crypto from "node:crypto"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { newId, query } from "../db.js"
import { writeAudit } from "../lib/audit.js"
import { notifyUser } from "./notifications-realtime.js"

export const notificationsRouter = Router()
notificationsRouter.use(requireAuth, requireRole("medical_officer", "mortuary_clerk", "pathologist", "public_health_analyst"))

const LIST_SELECT = `
  SELECT dn.notification_id, dn.date_of_death, dn.preliminary_icd_code, dn.clinical_summary,
         dn.status, dn.is_maternal_perinatal, dn.created_at, dn.updated_at,
         dn.rejection_reason, dn.rejected_by, dn.rejected_at,
         dn.assigned_to, dn.review_due_at,
         a2.full_name AS assignee_name,
         (dn.review_due_at IS NOT NULL AND dn.review_due_at < NOW() AND dn.status IN ('pending_review','under_review')) AS overdue,
         p.patient_id, p.full_name AS patient_name, p.national_id, p.age, p.gender,
         p.residential_address, p.latitude AS patient_lat, p.longitude AS patient_lng,
         f.facility_id, f.facility_name, f.district, f.province,
         ic.description AS icd_description, ic.disease_category,
         u.full_name AS reported_by_name
  FROM death_notifications dn
  JOIN patients p ON p.patient_id = dn.patient_id
  JOIN facilities f ON f.facility_id = dn.facility_id
  JOIN icd_codes ic ON ic.icd_code = dn.preliminary_icd_code
  JOIN users u ON u.user_id = dn.reported_by
  LEFT JOIN users a2 ON a2.user_id = dn.assigned_to`

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
  const [rows, [countRow]] = await Promise.all([
    query<any[]>(`${LIST_SELECT} ${whereSql} ORDER BY dn.date_of_death DESC LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]),
    query<any[]>(
      `SELECT COUNT(*) AS total FROM death_notifications dn
       JOIN patients p ON p.patient_id = dn.patient_id
       JOIN facilities f ON f.facility_id = dn.facility_id ${whereSql}`,
      params,
    ),
  ])
  res.json({ items: rows.map(row => req.user!.role === "mortuary_clerk" ? { ...row, clinical_summary: null } : row), total: Number(countRow?.total ?? 0), page, pageSize })
})

notificationsRouter.post("/", requireAuth, async (req, res) => { res.status(201).json(await createNotification(req, req.body)) })

notificationsRouter.get("/:id", requireAuth, async (req, res) => {
  if (!await canAccessNotification(req.user!, req.params.id)) return res.status(403).json({ error: "Record unavailable" })
  const rows = await query<any[]>(`${LIST_SELECT} WHERE dn.notification_id = ?`, [req.params.id])
  const row = rows[0]
  if (!row) return res.status(404).json({ error: "Notification not found" })
  if (facilityScoped(req.user!) && req.user!.facilityId && row.facility_id !== req.user!.facilityId) {
    return res.status(403).json({ error: "Forbidden: different facility" })
  }
  if (req.user!.role === "mortuary_clerk") return res.json({ notification: { ...row, clinical_summary: null }, images: [], autopsy: null, certification: null })
  const images = await query<any[]>(
    `SELECT image_id, mime_type, resolution, file_hash, original_size_bytes, compressed_size_bytes,
            compressed, uploaded_timestamp FROM tele_pathology_images WHERE notification_id = ?`,
    [req.params.id],
  )
  const autopsy = await query<any[]>(
    `SELECT a.autopsy_id, a.status, a.final_icd_code, a.final_cause_of_death, a.legal_threshold_flag,
            a.digital_signature, a.signature_hmac, a.finalized_at, u.full_name AS pathologist_name
     FROM autopsy_reports a JOIN users u ON u.user_id = a.pathologist_id WHERE a.notification_id = ?`,
    [req.params.id],
  )
  const certification = await query<any[]>(
    `SELECT c.*, u.full_name AS certified_by_name
     FROM medical_certifications c JOIN users u ON u.user_id = c.certified_by WHERE c.notification_id = ?`,
    [req.params.id],
  )
  res.json({ notification: row, images, autopsy: autopsy[0] ?? null, certification: certification[0] ?? null })
})

const patchSchema = z.object({
  status: z.enum(["under_review"]).optional(),
  clinicalSummary: z.string().max(8000).optional(),
  // Offline queue replays stamp the device-side change time — the server
  // rejects it when a newer write already landed (last-write-wins).
  clientUpdatedAt: z.string().optional(),
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

const certificationSchema = z.object({
  finalIcdCode: z.string().min(1).max(12),
  finalCauseOfDeath: z.string().min(2).max(512),
  mannerOfDeath: z.enum(["natural", "accident", "suicide", "homicide", "undetermined"]).default("natural"),
})

const rejectSchema = z.object({
  reason: z.string().min(2).max(2000),
})

const assignSchema = z.object({
  assignedTo: z.string().max(36).optional().nullable(),
  clientUpdatedAt: z.string().optional(),
})

// Pathologists record post-mortem findings and sign the final cause (Ch 4.4 step 3).
notificationsRouter.post(
  "/:id/autopsy",
  requireAuth,
  requireRole("pathologist"),
  async (req, res) => {
    const parsed = autopsySchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "Invalid autopsy data", issues: parsed.error.issues })
    const d = parsed.data

    const notif = await query<any[]>("SELECT notification_id, status, reported_by FROM death_notifications WHERE notification_id = ?", [
      req.params.id,
    ])
    if (!notif.length) return res.status(404).json({ error: "Notification not found" })
    await assertCaseOpen(req.params.id)
    const currentStatus = notif[0].status as CaseStatus
    const legalTarget: CaseStatus = d.finalize ? "finalized" : "autopsy_complete"
    if (!canTransition(currentStatus, legalTarget)) throw new Error(`Illegal transition: ${currentStatus} -> ${legalTarget}`)
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
    const finalizedAt = d.finalize ? new Date() : null
    const signatureHmac = d.finalize
      ? signReport(
          {
            type: "autopsy_report",
            autopsyId,
            notificationId: req.params.id,
            pathologistId: req.user!.userId,
            finalIcdCode: d.finalIcdCode,
            finalCauseOfDeath: d.finalCauseOfDeath,
            digitalSignature: d.digitalSignature,
            finalizedAt: finalizedAt!.toISOString(),
          },
          config.signatureHmacKey,
        )
      : null

    await query(
      `INSERT INTO autopsy_reports
       (autopsy_id, notification_id, pathologist_id, internal_observations, toxicology_results,
        legal_threshold_flag, final_icd_code, final_cause_of_death, digital_signature, signature_hmac, audit_hash, status, finalized_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        signatureHmac,
        auditHash,
        status,
        finalizedAt,
      ],
    )
    await query("UPDATE death_notifications SET status = ? WHERE notification_id = ?", [
      legalTarget,
      req.params.id,
    ])
    await writeAudit(req, {
      action: d.finalize ? "finalize_autopsy" : "create_autopsy",
      entityType: "autopsy_reports",
      entityId: autopsyId,
      details: { notificationId: req.params.id, finalIcd: d.finalIcdCode, legalThreshold: d.legalThresholdFlag },
    })
    if (d.finalize) {
      await notifyUser(notif[0].reported_by, "Autopsy finalized", `Case ${req.params.id} has been finalized.`, `/notifications/${req.params.id}`, "autopsy")
    }
    res.status(201).json({ autopsyId, status })
  },
)

// Medical Officer MCCD certification for natural-cause deaths without autopsy.
notificationsRouter.post(
  "/:id/certify",
  requireAuth,
  requireRole("medical_officer"),
  async (req, res) => {
    const parsed = certificationSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "Invalid certification data", issues: parsed.error.issues })
    const d = parsed.data

    if (!await canAccessNotification(req.user!, req.params.id)) return res.status(403).json({ error: "Record unavailable" })
    await assertCaseOpen(req.params.id)
    const notif = await query<any[]>("SELECT status, reported_by FROM death_notifications WHERE notification_id = ?", [req.params.id])
    const currentStatus = notif[0]?.status as CaseStatus
    if (!canTransition(currentStatus, "certified")) throw new Error(`Illegal transition: ${currentStatus} -> certified`)

    const [existingAutopsy] = await query<any[]>("SELECT autopsy_id FROM autopsy_reports WHERE notification_id = ?", [req.params.id])
    if (existingAutopsy) return res.status(409).json({ error: "An autopsy already exists; cannot certify without it" })
    const [existingCert] = await query<any[]>("SELECT certification_id FROM medical_certifications WHERE notification_id = ?", [req.params.id])
    if (existingCert) return res.status(409).json({ error: "Certification already exists" })
    const icd = await query<any[]>("SELECT icd_code FROM icd_codes WHERE icd_code = ?", [d.finalIcdCode])
    if (!icd.length) return res.status(400).json({ error: "Unknown final ICD code" })

    const certificationId = newId("mcc")
    const createdAt = new Date()
    const signerName = req.user!.name
    const auditHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ certificationId, notificationId: req.params.id, d, certifiedBy: req.user!.userId }))
      .digest("hex")
    const signatureHmac = signReport(
      {
        type: "medical_certification",
        certificationId,
        notificationId: req.params.id,
        certifiedBy: req.user!.userId,
        finalIcdCode: d.finalIcdCode,
        finalCauseOfDeath: d.finalCauseOfDeath,
        mannerOfDeath: d.mannerOfDeath,
        signerName,
        createdAt: createdAt.toISOString(),
      },
      config.signatureHmacKey,
    )

    await query(
      `INSERT INTO medical_certifications
       (certification_id, notification_id, certified_by, final_icd_code, final_cause_of_death,
        manner_of_death, signer_name, signature_hmac, audit_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [certificationId, req.params.id, req.user!.userId, d.finalIcdCode, d.finalCauseOfDeath, d.mannerOfDeath, signerName, signatureHmac, auditHash, createdAt],
    )
    await query("UPDATE death_notifications SET status = 'certified' WHERE notification_id = ?", [req.params.id])
    await writeAudit(req, {
      action: "certify_death",
      entityType: "medical_certifications",
      entityId: certificationId,
      details: { notificationId: req.params.id, finalIcd: d.finalIcdCode, manner: d.mannerOfDeath },
    })
    await notifyUser(notif[0].reported_by, "Death certified", `Case ${req.params.id} has been certified by the attending officer.`, `/notifications/${req.params.id}`, "certification")
    res.status(201).json({ certificationId, status: "certified" })
  },
)

// Analyst/Admin: reject an invalid or duplicate notification.
notificationsRouter.post(
  "/:id/reject",
  requireAuth,
  requireRole("public_health_analyst"),
  async (req, res) => {
    const parsed = rejectSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "Rejection requires a reason" })
    if (!await canAccessNotification(req.user!, req.params.id)) return res.status(403).json({ error: "Record unavailable" })

    const notif = await query<any[]>("SELECT status, reported_by FROM death_notifications WHERE notification_id = ?", [req.params.id])
    if (!notif.length) return res.status(404).json({ error: "Notification not found" })
    const currentStatus = notif[0].status as CaseStatus
    if (!canTransition(currentStatus, "rejected")) throw new Error(`Illegal transition: ${currentStatus} -> rejected`)

    await query(
      "UPDATE death_notifications SET status = 'rejected', rejection_reason = ?, rejected_by = ?, rejected_at = NOW() WHERE notification_id = ?",
      [parsed.data.reason, req.user!.userId, req.params.id],
    )
    await writeAudit(req, {
      action: "reject_death_notification",
      entityType: "death_notifications",
      entityId: req.params.id,
      details: { reason: parsed.data.reason },
    })
    await notifyUser(notif[0].reported_by, "Case rejected", `Case ${req.params.id} was rejected: ${parsed.data.reason}`, `/notifications/${req.params.id}`, "rejection")
    res.json({ ok: true })
  },
)

// Assign (or unassign) a notification to a pathologist; sets the review SLA clock.
notificationsRouter.patch(
  "/:id/assign",
  requireAuth,
  requireRole("public_health_analyst", "pathologist"),
  async (req, res) => {
    const parsed = assignSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "Invalid assignment" })
    if (!await canAccessNotification(req.user!, req.params.id)) return res.status(403).json({ error: "Record unavailable" })

    const notif = await query<any[]>("SELECT status, is_maternal_perinatal, reported_by, updated_at FROM death_notifications WHERE notification_id = ?", [req.params.id])
    if (!notif.length) return res.status(404).json({ error: "Notification not found" })
    if (isTerminal(notif[0].status as CaseStatus)) return res.status(409).json({ error: "Cannot assign a terminal case" })

    // LWW guard for queued offline assignments.
    const cut = parsed.data.clientUpdatedAt
    if (cut) {
      const clientTs = Date.parse(cut)
      const serverTs = notif[0].updated_at ? new Date(notif[0].updated_at).getTime() : 0
      if (Number.isFinite(clientTs) && clientTs < serverTs) {
        return res.status(409).json({ error: "A newer version was saved while offline — the server copy won.", conflict: true, serverUpdatedAt: notif[0].updated_at })
      }
    }

    const { assignedTo } = parsed.data
    if (assignedTo) {
      const [target] = await query<any[]>("SELECT user_id, role, status FROM users WHERE user_id = ?", [assignedTo])
      if (!target || target.status !== "active" || target.role !== "pathologist") {
        return res.status(400).json({ error: "Assignee must be an active pathologist" })
      }
      // Pathologists may only self-assign (or unassign).
      if (req.user!.role === "pathologist" && target.user_id !== req.user!.userId) {
        return res.status(403).json({ error: "Pathologists can only assign to themselves" })
      }
    } else if (req.user!.role === "pathologist") {
      return res.status(400).json({ error: "Pathologists can only assign, not unassign" })
    }

    const reviewDueAt = new Date(Date.now() + reviewSlaHours(notif[0].is_maternal_perinatal) * 60 * 60 * 1000)
    await query(
      "UPDATE death_notifications SET assigned_to = ?, review_due_at = ? WHERE notification_id = ?",
      [assignedTo ?? null, reviewDueAt, req.params.id],
    )
    if (assignedTo && assignedTo !== notif[0].reported_by) {
      await notifyUser(assignedTo, "Case assigned", `Case ${req.params.id} has been assigned to you.`, `/notifications/${req.params.id}`, "assignment")
    }
    await writeAudit(req, {
      action: "assign_notification",
      entityType: "death_notifications",
      entityId: req.params.id,
      details: { assignedTo },
    })
    res.json({ ok: true })
  },
)

// Update the clinical summary or manually move from pending_review to under_review.
notificationsRouter.patch(
  "/:id",
  requireAuth,
  requireRole("medical_officer", "public_health_analyst"),
  async (req, res) => {
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "Invalid update" })
    const d = parsed.data
    if (!await canAccessNotification(req.user!, req.params.id)) return res.status(403).json({ error: "Forbidden" })
    if (!d.status && d.clinicalSummary === undefined) return res.status(400).json({ error: "Nothing to update" })

    const notif = await query<any[]>("SELECT status, updated_at FROM death_notifications WHERE notification_id = ?", [req.params.id])
    if (!notif.length) return res.status(404).json({ error: "Notification not found" })
    const currentStatus = notif[0].status as CaseStatus
    if (isTerminal(currentStatus)) return res.status(409).json({ error: "Terminal case cannot be edited" })

    // LWW guard: a queued offline edit loses to a newer server-side write.
    if (d.clientUpdatedAt) {
      const clientTs = Date.parse(d.clientUpdatedAt)
      const serverTs = notif[0].updated_at ? new Date(notif[0].updated_at).getTime() : 0
      if (Number.isFinite(clientTs) && clientTs < serverTs) {
        return res.status(409).json({ error: "A newer version was saved while offline — the server copy won.", conflict: true, serverUpdatedAt: notif[0].updated_at })
      }
    }

    const sets: string[] = []
    const params: any[] = []
    if (d.status) {
      if (!isCaseStatus(d.status) || !canTransition(currentStatus, d.status)) {
        return res.status(409).json({ error: `Illegal status transition from ${currentStatus} to ${d.status}` })
      }
      sets.push("status = ?")
      params.push(d.status)
    }
    if (d.clinicalSummary !== undefined) {
      sets.push("clinical_summary = ?")
      params.push(d.clinicalSummary)
    }
    if (d.clientUpdatedAt) {
      sets.push("client_updated_at = ?")
      params.push(new Date(d.clientUpdatedAt))
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
