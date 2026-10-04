import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"
import { writeAudit } from "../lib/audit.js"

export const specimenTrackingRouter = Router()

// Create specimen tracking record
specimenTrackingRouter.post("/", requireAuth, requireRole("medical_officer", "mortuary_clerk", "pathologist", "system_admin"), async (req, res) => {
  const schema = z.object({
    notificationId: z.string(),
    specimenType: z.string(),
    collectionLocation: z.string(),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid specimen data" })
  
  const { notificationId, specimenType, collectionLocation } = parsed.data
  
  // Generate QR code
  const specimenQr = `SPEC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  const trackingId = crypto.randomUUID()
  
  await query(
    `INSERT INTO specimen_tracking (tracking_id, specimen_qr, notification_id, specimen_type, collected_by, collection_location, collection_date, current_location, status, tracking_log)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [trackingId, specimenQr, notificationId, specimenType, req.user!.userId, collectionLocation, new Date(), collectionLocation, "in_transit", JSON.stringify([{ location: collectionLocation, timestamp: new Date(), action: "collected" }])]
  )
  
  await writeAudit(req, { action: "create_specimen_tracking", entityType: "specimen_tracking", entityId: trackingId, details: { specimenQr, specimenType } })
  res.status(201).json({ trackingId, specimenQr })
})

// Update specimen location
specimenTrackingRouter.patch("/:trackingId/location", requireAuth, requireRole("medical_officer", "mortuary_clerk", "pathologist", "system_admin"), async (req, res) => {
  const schema = z.object({
    location: z.string(),
    action: z.string(),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid location data" })
  
  const { location, action } = parsed.data
  
  // Get current tracking log
  const current = await query<any[]>("SELECT tracking_log FROM specimen_tracking WHERE tracking_id = ?", [req.params.trackingId])
  const trackingLog = JSON.parse(current[0]?.tracking_log || "[]")
  
  // Add new log entry
  trackingLog.push({ location, timestamp: new Date(), action, user: req.user!.userId })
  
  await query(
    `UPDATE specimen_tracking 
     SET current_location = ?, current_holder = ?, tracking_log = ?, updated_at = ?
     WHERE tracking_id = ?`,
    [location, req.user!.userId, JSON.stringify(trackingLog), new Date(), req.params.trackingId]
  )
  
  await writeAudit(req, { action: "update_specimen_location", entityType: "specimen_tracking", entityId: req.params.trackingId, details: { location, action } })
  res.json({ ok: true })
})

// Get specimen tracking by QR
specimenTrackingRouter.get("/qr/:qr", requireAuth, requireRole("medical_officer", "mortuary_clerk", "pathologist", "public_health_analyst", "system_admin"), async (req, res) => {
  const specimen = await query<any[]>(
    `SELECT st.*, u.full_name as collector_name, u2.full_name as current_holder_name
     FROM specimen_tracking st
     JOIN users u ON u.user_id = st.collected_by
     LEFT JOIN users u2 ON u2.user_id = st.current_holder
     WHERE st.specimen_qr = ?`,
    [req.params.qr]
  )
  res.json({ item: specimen[0] || null })
})
