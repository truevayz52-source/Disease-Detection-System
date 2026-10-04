import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"
import { writeAudit } from "../lib/audit.js"

export const peerReviewRouter = Router()

// Request peer review
peerReviewRouter.post("/request", requireAuth, requireRole("pathologist", "public_health_analyst", "system_admin"), async (req, res) => {
  const schema = z.object({
    imageId: z.string(),
    reviewerId: z.string(),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid review request" })
  
  const { imageId, reviewerId } = parsed.data
  
  const reviewId = crypto.randomUUID()
  await query(
    `INSERT INTO peer_reviews (review_id, image_id, requester_id, reviewer_id, review_status)
     VALUES (?, ?, ?, ?, ?)`,
    [reviewId, imageId, req.user!.userId, reviewerId, "pending"]
  )
  
  await writeAudit(req, { action: "request_peer_review", entityType: "peer_reviews", entityId: reviewId, details: { imageId, reviewerId } })
  res.status(201).json({ reviewId })
})

// Submit peer review
peerReviewRouter.post("/:reviewId/submit", requireAuth, requireRole("pathologist", "public_health_analyst", "system_admin"), async (req, res) => {
  const schema = z.object({
    reviewNotes: z.string(),
    recommendation: z.string(),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid review data" })
  
  const { reviewNotes, recommendation } = parsed.data
  
  await query(
    `UPDATE peer_reviews 
     SET review_status = 'completed', review_notes = ?, recommendation = ?, completed_at = ?
     WHERE review_id = ?`,
    [reviewNotes, recommendation, new Date(), req.params.reviewId]
  )
  
  await writeAudit(req, { action: "submit_peer_review", entityType: "peer_reviews", entityId: req.params.reviewId, details: { recommendation } })
  res.json({ ok: true })
})

// Get pending reviews for user
peerReviewRouter.get("/pending", requireAuth, requireRole("pathologist", "public_health_analyst", "system_admin"), async (req, res) => {
  const reviews = await query<any[]>(
    `SELECT pr.*, ti.file_path, dn.notification_id
     FROM peer_reviews pr
     JOIN tele_pathology_images ti ON ti.image_id = pr.image_id
     JOIN death_notifications dn ON dn.notification_id = ti.notification_id
     WHERE pr.reviewer_id = ? AND pr.review_status = 'pending'
     ORDER BY pr.requested_at DESC`,
    [req.user!.userId]
  )
  res.json({ items: reviews })
})
