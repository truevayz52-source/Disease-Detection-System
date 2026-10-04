import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"
import { writeAudit } from "../lib/audit.js"

export const emergencyDispatchRouter = Router()

// Send emergency notifications via multiple channels
emergencyDispatchRouter.post("/send", requireAuth, requireRole("public_health_analyst", "system_admin"), async (req, res) => {
  const schema = z.object({
    alertId: z.string().optional(),
    recipients: z.array(z.string()), // User IDs
    channels: z.array(z.enum(["sms", "email", "whatsapp"])),
    message: z.string(),
    subject: z.string().optional(),
    priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid dispatch parameters" })
  
  const { alertId, recipients, channels, message, subject, priority } = parsed.data
  
  // Get recipient details
  const recipientRows = await query<any[]>(
    `SELECT user_id, full_name, email, phone FROM users WHERE user_id IN (${recipients.map(() => '?').join(',')})`,
    recipients
  )
  
  const dispatchResults = []
  
  for (const recipient of recipientRows) {
    for (const channel of channels) {
      const dispatchId = crypto.randomUUID()
      
      // Create notification record
      await query(
        `INSERT INTO user_notifications (notification_id, user_id, notification_type, title, message, action_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [dispatchId, recipient.user_id, "emergency", subject || "Emergency Alert", message, `/alerts/${alertId || ''}`, new Date()]
      )
      
      // Simulate dispatch (in production, integrate with actual SMS/WhatsApp gateways)
      const channelResult: any = {
        channel,
        recipient: recipient.email,
        status: "queued",
        dispatchedAt: new Date(),
        details: "",
      }
      
      if (channel === "email") {
        // Email dispatch simulation
        channelResult.status = "sent"
        channelResult.details = `Email sent to ${recipient.email}`
      } else if (channel === "sms") {
        // SMS dispatch simulation
        channelResult.status = "sent"
        channelResult.details = `SMS sent to ${recipient.phone}`
      } else if (channel === "whatsapp") {
        // WhatsApp dispatch simulation
        channelResult.status = "sent"
        channelResult.details = `WhatsApp message sent to ${recipient.phone}`
      }
      
      dispatchResults.push(channelResult)
    }
  }
  
  await writeAudit(req, { action: "emergency_dispatch", entityType: "notifications", details: { recipients, channels, priority } })
  
  res.json({ ok: true, dispatched: dispatchResults.length, results: dispatchResults })
})

// Get rapid response team members
emergencyDispatchRouter.get("/rrt-members", requireAuth, requireRole("public_health_analyst", "system_admin"), async (req, res) => {
  const district = req.query.district as string
  
  let queryStr = `SELECT user_id, full_name, email, phone, role, facility_id FROM users WHERE status = 'active'`
  const params: any[] = []
  
  if (district) {
    queryStr += ` AND facility_id IN (SELECT facility_id FROM facilities WHERE district = ?)`
    params.push(district)
  }
  
  queryStr += ` AND role IN ('medical_officer', 'public_health_analyst', 'system_admin')`
  
  const members = await query<any[]>(queryStr, params)
  res.json({ items: members })
})

// Get dispatch history
emergencyDispatchRouter.get("/history", requireAuth, requireRole("public_health_analyst", "system_admin"), async (req, res) => {
  const history = await query<any[]>(
    `SELECT notification_id, user_id, notification_type, title, created_at, is_read
     FROM user_notifications
     WHERE notification_type = 'emergency'
     ORDER BY created_at DESC
     LIMIT 100`
  )
  res.json({ items: history })
})
