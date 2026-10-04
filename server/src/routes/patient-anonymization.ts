import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"
import { writeAudit } from "../lib/audit.js"

export const patientAnonymizationRouter = Router()

// Get anonymized patient data (role-based data scrubbing)
patientAnonymizationRouter.get("/:notificationId", requireAuth, async (req, res) => {
  const role = req.user!.role
  
  // Public health analysts and executives get anonymized data
  const shouldAnonymize = role === "public_health_analyst" || role === "executive"
  
  if (!shouldAnonymize) {
    // For other roles, return full data
    const patient = await query<any[]>(
      `SELECT p.*, dn.notification_id 
       FROM patients p
       JOIN death_notifications dn ON dn.patient_id = p.patient_id
       WHERE dn.notification_id = ?`,
      [req.params.notificationId]
    )
    return res.json({ item: patient[0] || null, anonymized: false })
  }
  
  // Get full patient data first
  const patient = await query<any[]>(
    `SELECT p.*, dn.notification_id 
     FROM patients p
     JOIN death_notifications dn ON dn.patient_id = p.patient_id
     WHERE dn.notification_id = ?`,
    [req.params.notificationId]
  )
  
  if (!patient[0]) return res.status(404).json({ error: "Patient not found" })
  
  // Anonymize PII
  const anonymized = {
    ...patient[0],
    full_name: "[REDACTED]",
    national_id: "[REDACTED]",
    phone: "[REDACTED]",
    address: "[REDACTED]",
    next_of_kin_name: "[REDACTED]",
    next_of_kin_phone: "[REDACTED]",
  }
  
  // Log anonymization access
  const logId = crypto.randomUUID()
  await query(
    `INSERT INTO anonymization_logs (log_id, user_id, entity_type, entity_id, anonymized_fields, access_purpose)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [logId, req.user!.userId, "patients", req.params.notificationId, 
     JSON.stringify(["full_name", "national_id", "phone", "address", "next_of_kin_name", "next_of_kin_phone"]), 
     req.query.purpose || "analysis"]
  )
  
  await writeAudit(req, { action: "access_anonymized_data", entityType: "anonymization_logs", entityId: logId, details: { notificationId: req.params.notificationId } })
  
  res.json({ item: anonymized, anonymized: true })
})

// Get anonymization logs (for audit)
patientAnonymizationRouter.get("/logs/:entityId", requireAuth, requireRole("system_admin", "public_health_analyst"), async (req, res) => {
  const logs = await query<any[]>(
    `SELECT al.*, u.full_name as user_name, u.role
     FROM anonymization_logs al
     JOIN users u ON u.user_id = al.user_id
     WHERE al.entity_id = ?
     ORDER BY al.requested_at DESC`,
    [req.params.entityId]
  )
  res.json({ items: logs })
})
