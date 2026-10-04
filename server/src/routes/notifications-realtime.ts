import { Router } from "../lib/router.js"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query, newId } from "../db.js"
import { z } from "zod"
import { writeAudit } from "../lib/audit.js"
import { events } from "../websocket/index.js"

export const realtimeRouter = Router()
realtimeRouter.use(requireAuth)
export async function notifyUser(userId: string, title: string, message: string, actionUrl: string, type = "info") {
  await query("INSERT INTO user_notifications (notification_id,user_id,notification_type,title,message,action_url) VALUES (?,?,?,?,?,?)", [newId("msg"),userId,type,title,message,actionUrl])
  events.emit("inbox",userId)
}
realtimeRouter.get("/", async (req, res) => {
  const items = await query<any[]>("SELECT * FROM user_notifications WHERE user_id=? AND (expires_at IS NULL OR expires_at>NOW()) ORDER BY created_at DESC LIMIT 100", [req.user!.userId])
  const [count] = await query<any[]>("SELECT COUNT(*) AS unread FROM user_notifications WHERE user_id=? AND is_read=0 AND (expires_at IS NULL OR expires_at>NOW())", [req.user!.userId])
  res.json({ items, unread: Number(count.unread) })
})
realtimeRouter.patch("/read-all", async (req,res) => {
  await query("UPDATE user_notifications SET is_read=1 WHERE user_id=?",[req.user!.userId]); res.json({ok:true})
})
realtimeRouter.patch("/:id/read", async (req,res) => {
  await query("UPDATE user_notifications SET is_read=1 WHERE notification_id=? AND user_id=?",[req.params.id,req.user!.userId]); res.json({ok:true})
})
realtimeRouter.delete("/:id", async (req,res) => {
  await query("DELETE FROM user_notifications WHERE notification_id=? AND user_id=?",[req.params.id,req.user!.userId]); res.json({ok:true})
})
const messageSchema=z.object({userIds:z.array(z.string().max(36)).min(1).max(100),title:z.string().min(1).max(255),message:z.string().max(4000),actionUrl:z.string().max(512).regex(/^\/(?!\/)/).default("/notifications-center")})
realtimeRouter.post("/send",requireRole("system_admin"),async(req,res)=>{
  const d=messageSchema.parse(req.body)
  for (const id of new Set(d.userIds)) await notifyUser(id,d.title,d.message,d.actionUrl)
  await writeAudit(req,{action:"send_notification",entityType:"user_notifications",details:{recipients:d.userIds.length}})
  res.json({ok:true})
})
