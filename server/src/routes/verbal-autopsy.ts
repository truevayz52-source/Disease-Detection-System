import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"
import { writeAudit } from "../lib/audit.js"

export const verbalAutopsyRouter = Router()

// Create verbal autopsy record (WHO/InterVA-5 standards)
verbalAutopsyRouter.post("/", requireAuth, requireRole("medical_officer", "pathologist", "public_health_analyst", "system_admin"), async (req, res) => {
  const schema = z.object({
    notificationId: z.string(),
    interviewerName: z.string(),
    interviewDate: z.string(),
    // InterVA-5 compatible structure — any object shape, but bounded in size.
    vaData: z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v).length <= 65536, "vaData exceeds 64KB"),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid verbal autopsy data" })
  
  const { notificationId, interviewerName, interviewDate, vaData } = parsed.data
  
  const vaId = crypto.randomUUID()
  await query(
    `INSERT INTO verbal_autopsies (va_id, notification_id, interviewer_name, interview_date, va_data)
     VALUES (?, ?, ?, ?, ?)`,
    [vaId, notificationId, interviewerName, interviewDate, JSON.stringify(vaData)]
  )
  
  await writeAudit(req, { action: "create_verbal_autopsy", entityType: "verbal_autopsies", entityId: vaId, details: { notificationId } })
  res.status(201).json({ vaId })
})

// Get verbal autopsy
verbalAutopsyRouter.get("/:notificationId", requireAuth, requireRole("medical_officer", "pathologist", "public_health_analyst", "system_admin"), async (req, res) => {
  const va = await query<any[]>(
    "SELECT * FROM verbal_autopsies WHERE notification_id = ?",
    [req.params.notificationId]
  )
  res.json({ item: va[0] || null })
})
