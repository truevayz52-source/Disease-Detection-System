import { Router } from "../lib/router.js"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query, newId } from "../db.js"
import { z } from "zod"
import { writeAudit } from "../lib/audit.js"
import { canAccessNotification, facilityScoped } from "../lib/access.js"
import { notifyUser } from "./notifications-realtime.js"

export const workflowsRouter = Router()
workflowsRouter.use(["/mpdsr","/alerts/thresholds","/cross-border","/comments"],requireAuth)
const analysts = requireRole("public_health_analyst","system_admin")
const clinical = requireRole("medical_officer","public_health_analyst","system_admin")
workflowsRouter.get("/mpdsr/workflows",clinical,async(req,res)=>{
  res.json({items:await query<any[]>(`SELECT w.*, f.facility_name FROM mpdsr_workflows w JOIN death_notifications dn ON dn.notification_id=w.notification_id JOIN facilities f ON f.facility_id=dn.facility_id ${facilityScoped(req.user!)?"WHERE dn.facility_id=?":""} ORDER BY w.created_at DESC LIMIT 200`,facilityScoped(req.user!)?[req.user!.facilityId]:[])})
})
workflowsRouter.post("/mpdsr/initiate",clinical,async(req,res)=>{
  const d=z.object({notificationId:z.string().max(36),department:z.string().min(2).max(255)}).parse(req.body)
  if(!await canAccessNotification(req.user!,d.notificationId))return res.status(403).json({error:"Record unavailable"})
  const [notification]=await query<any[]>("SELECT is_maternal_perinatal FROM death_notifications WHERE notification_id=?",[d.notificationId])
  if(!notification.is_maternal_perinatal)return res.status(400).json({error:"Select a maternal or perinatal notification"})
  const [existing]=await query<any[]>("SELECT workflow_id FROM mpdsr_workflows WHERE notification_id=?",[d.notificationId])
  if(existing)return res.status(409).json({error:"Workflow already exists"})
  const id=newId("mpd")
  await query("INSERT INTO mpdsr_workflows (workflow_id,notification_id,initiated_by,department_notified,notification_timestamp) VALUES (?,?,?,?,NOW())",[id,d.notificationId,req.user!.userId,d.department])
  await writeAudit(req,{action:"initiate_mpdsr",entityType:"mpdsr_workflows",entityId:id})
  res.status(201).json({workflowId:id})
})
workflowsRouter.patch("/mpdsr/workflows/:id",clinical,async(req,res)=>{
  const d=z.object({status:z.enum(["pending","investigating","completed"]),notes:z.string().max(16000)}).parse(req.body)
  const [row]=await query<any[]>("SELECT notification_id FROM mpdsr_workflows WHERE workflow_id=?",[req.params.id])
  if(!row||!await canAccessNotification(req.user!,row.notification_id))return res.status(403).json({error:"Record unavailable"})
  await query("UPDATE mpdsr_workflows SET response_status=?,investigation_notes=? WHERE workflow_id=?",[d.status,d.notes,req.params.id])
  await writeAudit(req,{action:"update_mpdsr",entityType:"mpdsr_workflows",entityId:req.params.id})
  res.json({ok:true})
})
const threshold=z.object({district:z.string().max(100).nullable().default(null),diseaseCategory:z.string().max(100).nullable().default(null),caseThreshold:z.number().int().min(1).max(100000),timeWindowHours:z.number().int().min(1).max(8760),priority:z.enum(["normal","high","critical"]).default("normal"),active:z.boolean().default(true)})
workflowsRouter.get("/alerts/thresholds",analysts,async(_req,res)=>res.json({items:await query("SELECT * FROM alert_thresholds ORDER BY created_at DESC")}))
workflowsRouter.post("/alerts/thresholds",analysts,async(req,res)=>{
  const d=threshold.parse(req.body),id=newId("thr")
  await query("INSERT INTO alert_thresholds (threshold_id,configured_by,district,disease_category,case_threshold,time_window_hours,alert_priority,is_active) VALUES (?,?,?,?,?,?,?,?)",[id,req.user!.userId,d.district,d.diseaseCategory,d.caseThreshold,d.timeWindowHours,d.priority,d.active])
  await writeAudit(req,{action:"create_threshold",entityType:"alert_thresholds",entityId:id,details:d});res.status(201).json({id})
})
workflowsRouter.patch("/alerts/thresholds/:id",analysts,async(req,res)=>{
  const d=threshold.parse(req.body)
  await query("UPDATE alert_thresholds SET district=?,disease_category=?,case_threshold=?,time_window_hours=?,alert_priority=?,is_active=? WHERE threshold_id=?",[d.district,d.diseaseCategory,d.caseThreshold,d.timeWindowHours,d.priority,d.active,req.params.id])
  await writeAudit(req,{action:"update_threshold",entityType:"alert_thresholds",entityId:req.params.id,details:d});res.json({ok:true})
})
workflowsRouter.delete("/alerts/thresholds/:id",analysts,async(req,res)=>{
  await query("DELETE FROM alert_thresholds WHERE threshold_id=?",[req.params.id]);await writeAudit(req,{action:"delete_threshold",entityType:"alert_thresholds",entityId:req.params.id});res.json({ok:true})
})
workflowsRouter.get("/cross-border/cases",clinical,async(req,res)=>{
  res.json({items:await query(`SELECT c.*,f.district FROM cross_border_cases c JOIN death_notifications dn ON dn.notification_id=c.notification_id JOIN facilities f ON f.facility_id=dn.facility_id ${facilityScoped(req.user!)?"WHERE dn.facility_id=?":""} ORDER BY c.created_at DESC LIMIT 200`,facilityScoped(req.user!)?[req.user!.facilityId]:[])})
})
workflowsRouter.post("/cross-border/mark",clinical,async(req,res)=>{
  const d=z.object({notificationId:z.string().max(36),sourceCountry:z.string().min(2).max(100),borderCrossingPoint:z.string().max(255),travelHistory:z.string().max(4000)}).parse(req.body)
  if(!await canAccessNotification(req.user!,d.notificationId))return res.status(403).json({error:"Record unavailable"})
  const id=newId("cross")
  await query("INSERT INTO cross_border_cases (cross_border_id,notification_id,source_country,border_crossing_point,travel_history) VALUES (?,?,?,?,?)",[id,d.notificationId,d.sourceCountry,d.borderCrossingPoint,d.travelHistory])
  await writeAudit(req,{action:"mark_cross_border",entityType:"cross_border_cases",entityId:id});res.status(201).json({id})
})
workflowsRouter.get("/comments/:entityType/:entityId",async(req,res)=>{
  if(req.params.entityType!=="death_notifications"||!await canAccessNotification(req.user!,req.params.entityId,true))return res.status(403).json({error:"Record unavailable"})
  res.json({items:await query("SELECT c.*,u.full_name FROM entity_comments c JOIN users u ON u.user_id=c.user_id WHERE entity_type=? AND entity_id=? ORDER BY c.created_at LIMIT 200",[req.params.entityType,req.params.entityId])})
})
workflowsRouter.post("/comments",async(req,res)=>{
  const d=z.object({entityType:z.literal("death_notifications"),entityId:z.string().max(36),text:z.string().trim().min(1).max(4000),mentions:z.array(z.string().max(36)).max(20).default([])}).parse(req.body)
  if(!await canAccessNotification(req.user!,d.entityId,true))return res.status(403).json({error:"Record unavailable"})
  const id=newId("cmt")
  await query("INSERT INTO entity_comments (comment_id,entity_type,entity_id,user_id,comment_text,mentioned_users) VALUES (?,?,?,?,?,?)",[id,d.entityType,d.entityId,req.user!.userId,d.text,JSON.stringify(d.mentions)])
  for(const userId of new Set(d.mentions)) {
    const [user]=await query<any[]>("SELECT role,facility_id AS facilityId FROM users WHERE user_id=? AND status='active'",[userId])
    if(user && await canAccessNotification(user,d.entityId,true))await notifyUser(userId,"You were mentioned",`${req.user!.name} mentioned you in a case discussion.`,`/notifications/${d.entityId}`,"mention")
  }
  await writeAudit(req,{action:"add_comment",entityType:d.entityType,entityId:d.entityId});res.status(201).json({id})
})
workflowsRouter.delete("/comments/:id",async(req,res)=>{
  const result=await query<any>("DELETE FROM entity_comments WHERE comment_id=? AND user_id=?",[req.params.id,req.user!.userId])
  if(!result.affectedRows)return res.status(404).json({error:"Comment not found"})
  await writeAudit(req,{action:"delete_comment",entityType:"entity_comments",entityId:req.params.id});res.json({ok:true})
})
