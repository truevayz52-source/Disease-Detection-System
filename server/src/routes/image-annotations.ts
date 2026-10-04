import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"
import { writeAudit } from "../lib/audit.js"

export const imageAnnotationRouter = Router()

// Add annotation to image
imageAnnotationRouter.post("/", requireAuth, requireRole("pathologist", "medical_officer", "public_health_analyst", "system_admin"), async (req, res) => {
  const schema = z.object({
    imageId: z.string(),
    annotationType: z.enum(["marker", "measurement", "text", "voice"]),
    coordinates: z.object({ x: z.number(), y: z.number(), width: z.number().optional(), height: z.number().optional() }),
    textNote: z.string().optional(),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid annotation data" })
  
  const { imageId, annotationType, coordinates, textNote } = parsed.data
  
  const annotationId = crypto.randomUUID()
  await query(
    `INSERT INTO image_annotations (annotation_id, image_id, user_id, annotation_type, coordinates, text_note)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [annotationId, imageId, req.user!.userId, annotationType, JSON.stringify(coordinates), textNote || null]
  )
  
  await writeAudit(req, { action: "add_annotation", entityType: "image_annotations", entityId: annotationId, details: { imageId, annotationType } })
  res.status(201).json({ annotationId })
})

// Get annotations for image
imageAnnotationRouter.get("/:imageId", requireAuth, requireRole("pathologist", "medical_officer", "public_health_analyst", "system_admin"), async (req, res) => {
  const annotations = await query<any[]>(
    `SELECT ia.*, u.full_name as annotator_name
     FROM image_annotations ia
     JOIN users u ON u.user_id = ia.user_id
     WHERE ia.image_id = ?
     ORDER BY ia.created_at ASC`,
    [req.params.imageId]
  )
  res.json({ items: annotations })
})
