import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"
import { writeAudit } from "../lib/audit.js"

export const crvsBridgeRouter = Router()

// Register death with CRVS system
crvsBridgeRouter.post("/register", requireAuth, requireRole("medical_officer", "mortuary_clerk", "public_health_analyst", "system_admin"), async (req, res) => {
  const schema = z.object({
    notificationId: z.string(),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid notification ID" })
  
  const { notificationId } = parsed.data
  
  const bridgeId = crypto.randomUUID()
  // Simulate CRVS registration - in production, integrate with actual CRVS API via HL7 FHIR
  const crvsReference = `CRVS-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  
  await query(
    `INSERT INTO crvs_bridge (bridge_id, notification_id, crvs_reference_number, integration_status, sent_at)
     VALUES (?, ?, ?, ?, ?)`,
    [bridgeId, notificationId, crvsReference, "pending", new Date()]
  )
  
  // Simulate successful registration
  await query(
    `UPDATE crvs_bridge 
     SET integration_status = 'acknowledged', acknowledged_at = ?, error_message = NULL
     WHERE bridge_id = ?`,
    [new Date(), bridgeId]
  )
  
  await writeAudit(req, { action: "crvs_register", entityType: "crvs_bridge", entityId: bridgeId, details: { notificationId, crvsReference } })
  res.status(201).json({ bridgeId, crvsReference })
})

// Get CRVS integration status
crvsBridgeRouter.get("/status/:notificationId", requireAuth, requireRole("medical_officer", "mortuary_clerk", "pathologist", "public_health_analyst", "system_admin"), async (req, res) => {
  const bridge = await query<any[]>(
    "SELECT * FROM crvs_bridge WHERE notification_id = ?",
    [req.params.notificationId]
  )
  res.json({ item: bridge[0] || null })
})
