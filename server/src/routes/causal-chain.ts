import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"
import { writeAudit } from "../lib/audit.js"

export const causalChainRouter = Router()

// Create or update causal chain COD
causalChainRouter.post("/", requireAuth, requireRole("medical_officer", "pathologist", "public_health_analyst", "system_admin"), async (req, res) => {
  const schema = z.object({
    notificationId: z.string(),
    underlyingCause: z.string(),
    intermediateCause: z.string().optional(),
    immediateCause: z.string().optional(),
    contributoryConditions: z.array(z.string()).optional(),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid causal chain data" })
  
  const { notificationId, underlyingCause, intermediateCause, immediateCause, contributoryConditions } = parsed.data
  
  // Check if chain already exists
  const existing = await query<any[]>("SELECT chain_id FROM causal_chain_cod WHERE notification_id = ?", [notificationId])
  
  if (existing.length > 0) {
    await query(
      `UPDATE causal_chain_cod 
       SET underlying_cause = ?, intermediate_cause = ?, immediate_cause = ?, contributory_conditions = ?, updated_at = ?
       WHERE notification_id = ?`,
      [underlyingCause, intermediateCause || null, immediateCause || null, JSON.stringify(contributoryConditions || []), new Date(), notificationId]
    )
  } else {
    const chainId = crypto.randomUUID()
    await query(
      `INSERT INTO causal_chain_cod (chain_id, notification_id, underlying_cause, intermediate_cause, immediate_cause, contributory_conditions, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [chainId, notificationId, underlyingCause, intermediateCause || null, immediateCause || null, JSON.stringify(contributoryConditions || []), req.user!.userId]
    )
  }
  
  await writeAudit(req, { action: "update_causal_chain", entityType: "causal_chain_cod", entityId: notificationId, details: parsed.data })
  res.json({ ok: true })
})

// Get causal chain for a notification
causalChainRouter.get("/:notificationId", requireAuth, requireRole("medical_officer", "pathologist", "public_health_analyst", "system_admin"), async (req, res) => {
  const chain = await query<any[]>(
    "SELECT * FROM causal_chain_cod WHERE notification_id = ?",
    [req.params.notificationId]
  )
  res.json({ item: chain[0] || null })
})
