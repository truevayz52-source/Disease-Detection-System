import { Router } from "../lib/router.js"
import { z } from "zod"
import { newId, query } from "../db.js"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { writeAudit } from "../lib/audit.js"

export const playbooksRouter = Router()

const viewRoles = ["medical_officer", "mortuary_clerk", "public_health_analyst", "system_admin"] as const
const manageRoles = ["public_health_analyst", "system_admin"] as const

playbooksRouter.get("/", requireAuth, requireRole(...viewRoles), async (_req, res) => {
  const items = await query<any[]>("SELECT * FROM response_playbooks ORDER BY name")
  res.json({ items })
})

const createSchema = z.object({
  name: z.string().min(2).max(255),
  description: z.string().max(4000).optional(),
  signalType: z.enum(["rumour", "outbreak_report", "misinformation", "community_alert"]).optional(),
  diseaseCategory: z.string().max(100).optional(),
  steps: z.array(z.string().min(1).max(500)).min(1),
})

playbooksRouter.post("/", requireAuth, requireRole(...manageRoles), async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid playbook data" })
  const d = parsed.data

  const id = newId("pbk")
  await query(
    "INSERT INTO response_playbooks (playbook_id, name, description, signal_type, disease_category, steps, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, d.name, d.description ?? null, d.signalType ?? null, d.diseaseCategory ?? null, JSON.stringify(d.steps), req.user!.userId],
  )
  await writeAudit(req, { action: "playbook_created", entityType: "response_playbooks", entityId: id })
  res.status(201).json({ playbookId: id })
})
