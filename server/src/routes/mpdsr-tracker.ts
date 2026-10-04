import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"
import { writeAudit } from "../lib/audit.js"

export const mpdsrTrackerRouter = Router()

// Create or update MPDSR workflow with action tracking
// NOTE: parallels POST /api/mpdsr/initiate in workflows.ts — kept separate intentionally.
mpdsrTrackerRouter.post("/workflow", requireAuth, requireRole("medical_officer", "public_health_analyst", "system_admin"), async (req, res) => {
  const schema = z.object({
    notificationId: z.string(),
    responseStatus: z.enum(["pending", "in_progress", "investigation", "closed"]),
    investigationNotes: z.string().optional(),
    systemicCauses: z.array(z.string()).optional(),
    correctiveActions: z.array(z.string()).optional(),
    responsibleDepartment: z.string().optional(),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid MPDSR workflow data" })
  
  const { notificationId, responseStatus, investigationNotes, systemicCauses, correctiveActions, responsibleDepartment } = parsed.data
  
  // Check if workflow exists
  const existing = await query<any[]>("SELECT workflow_id FROM mpdsr_workflows WHERE notification_id = ?", [notificationId])
  
  if (existing.length > 0) {
    await query(
      `UPDATE mpdsr_workflows 
       SET response_status = ?, investigation_notes = ?, updated_at = ?
       WHERE notification_id = ?`,
      [responseStatus, investigationNotes || null, new Date(), notificationId]
    )
  } else {
    const workflowId = crypto.randomUUID()
    await query(
      `INSERT INTO mpdsr_workflows (workflow_id, notification_id, initiated_by, department_notified, response_status, investigation_notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [workflowId, notificationId, req.user!.userId, responsibleDepartment || null, responseStatus, investigationNotes || null]
    )
  }
  
  // Log action tracking
  if (systemicCauses || correctiveActions) {
    const actionLogId = crypto.randomUUID()
    await query(
      `INSERT INTO entity_comments (comment_id, entity_type, entity_id, user_id, comment_text, mentioned_users)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [actionLogId, "mpdsr_workflow", notificationId, req.user!.userId, 
       JSON.stringify({ systemicCauses, correctiveActions }), JSON.stringify([])]
    )
  }
  
  await writeAudit(req, { action: "update_mpdsr_workflow", entityType: "mpdsr_workflows", entityId: notificationId, details: parsed.data })
  res.json({ ok: true })
})

// Get MPDSR workflow
mpdsrTrackerRouter.get("/:notificationId", requireAuth, requireRole("medical_officer", "public_health_analyst", "system_admin"), async (req, res) => {
  const workflow = await query<any[]>(
    `SELECT * FROM mpdsr_workflows WHERE notification_id = ?`,
    [req.params.notificationId]
  )
  
  // Get action comments
  const comments = await query<any[]>(
    `SELECT * FROM entity_comments WHERE entity_type = 'mpdsr_workflow' AND entity_id = ? ORDER BY created_at`,
    [req.params.notificationId]
  )
  
  res.json({ workflow: workflow[0] || null, comments })
})

// Get all MPDSR workflows
mpdsrTrackerRouter.get("/", requireAuth, requireRole("medical_officer", "public_health_analyst", "system_admin"), async (req, res) => {
  const status = req.query.status as string
  
  let queryStr = `SELECT mw.*, dn.date_of_death, p.full_name as patient_name, f.facility_name
                  FROM mpdsr_workflows mw
                  JOIN death_notifications dn ON dn.notification_id = mw.notification_id
                  JOIN patients p ON p.patient_id = dn.patient_id
                  JOIN facilities f ON f.facility_id = dn.facility_id`
  const params: any[] = []
  
  if (status) {
    queryStr += " WHERE mw.response_status = ?"
    params.push(status)
  }
  
  queryStr += " ORDER BY mw.created_at DESC"
  
  const workflows = await query<any[]>(queryStr, params)
  res.json({ items: workflows })
})
