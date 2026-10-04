import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"
import { writeAudit } from "../lib/audit.js"

export const decodePanelRouter = Router()

// Create DeCoDe panel review
decodePanelRouter.post("/", requireAuth, requireRole("pathologist", "system_admin"), async (req, res) => {
  const schema = z.object({
    notificationId: z.string(),
    panelMembers: z.array(z.string()), // User IDs
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid panel data" })
  
  const { notificationId, panelMembers } = parsed.data
  
  const panelId = crypto.randomUUID()
  await query(
    `INSERT INTO decode_panels (panel_id, notification_id, panel_lead, panel_members, status)
     VALUES (?, ?, ?, ?, ?)`,
    [panelId, notificationId, req.user!.userId, JSON.stringify(panelMembers), "pending"]
  )
  
  await writeAudit(req, { action: "create_decode_panel", entityType: "decode_panels", entityId: panelId, details: { notificationId, panelMembers } })
  res.status(201).json({ panelId })
})

// Submit consensus diagnosis
decodePanelRouter.post("/:panelId/consensus", requireAuth, requireRole("pathologist", "system_admin"), async (req, res) => {
  const schema = z.object({
    consensusCause: z.string(),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid consensus data" })
  
  const { consensusCause } = parsed.data
  
  await query(
    `UPDATE decode_panels 
     SET consensus_cause = ?, consensus_date = ?, status = 'completed'
     WHERE panel_id = ?`,
    [consensusCause, new Date(), req.params.panelId]
  )
  
  await writeAudit(req, { action: "submit_consensus", entityType: "decode_panels", entityId: req.params.panelId, details: { consensusCause } })
  res.json({ ok: true })
})

// Get panel details
decodePanelRouter.get("/:panelId", requireAuth, requireRole("pathologist", "public_health_analyst", "system_admin"), async (req, res) => {
  const panel = await query<any[]>(
    "SELECT * FROM decode_panels WHERE panel_id = ?",
    [req.params.panelId]
  )
  res.json({ item: panel[0] || null })
})
