import { Router } from "../lib/router.js"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query, newId } from "../db.js"
import { z } from "zod"
import { writeAudit } from "../lib/audit.js"
import { canAccessNotification, facilityScoped } from "../lib/access.js"
import { notifyUser } from "./notifications-realtime.js"

export const workflowsRouter = Router()
workflowsRouter.use(["/mpdsr","/alerts/thresholds","/cross-border","/comments"],requireAuth)
const analysts = requireRole("public_health_analyst")
const clinical = requireRole("medical_officer","public_health_analyst")
// ---------------------------------------------------------------------------
// MPDSR — maternal/perinatal death surveillance & response.
// Review pipeline: notified → in_review → actions_assigned → completed.
// A review may only close once every corrective action is done/cancelled —
// that is the "closed loop" the committee is accountable for.
// ---------------------------------------------------------------------------
const MPDSR_STAGES = ["notified", "in_review", "actions_assigned", "completed"] as const
const MPDSR_CAUSES = ["direct_obstetric", "indirect_obstetric", "coincidental", "undetermined"] as const
const MPDSR_PREVENTABILITY = ["preventable", "potentially_preventable", "not_preventable", "undetermined"] as const
const NEXT_STAGE: Record<string, string[]> = {
  notified: ["in_review"],
  in_review: ["actions_assigned", "completed"],
  actions_assigned: ["completed"],
}

workflowsRouter.get("/mpdsr/queue",clinical,async(req,res)=>{
  const scoped = facilityScoped(req.user!)
  res.json({items:await query<any[]>(
    `SELECT dn.notification_id, p.full_name AS patient_name, f.facility_name, f.district,
            dn.date_of_death, dn.created_at
     FROM death_notifications dn
     JOIN patients p ON p.patient_id=dn.patient_id
     JOIN facilities f ON f.facility_id=dn.facility_id
     WHERE dn.is_maternal_perinatal AND dn.status<>'rejected'
       AND NOT EXISTS (SELECT 1 FROM mpdsr_workflows w WHERE w.notification_id=dn.notification_id)
       ${scoped?"AND dn.facility_id=?":""}
     ORDER BY dn.created_at DESC LIMIT 100`,scoped?[req.user!.facilityId]:[])})
})
workflowsRouter.get("/mpdsr/workflows",clinical,async(req,res)=>{
  const scoped = facilityScoped(req.user!)
  const stage = req.query.stage as string | undefined
  const stageSql = MPDSR_STAGES.includes(stage as any) ? " AND w.response_status=?" : ""
  res.json({items:await query<any[]>(
    `SELECT w.*, p.full_name AS patient_name, f.facility_name, f.district, dn.date_of_death,
            (SELECT COUNT(*) FROM mpdsr_actions a WHERE a.workflow_id=w.workflow_id AND a.status='open') AS open_actions,
            (w.review_due_at IS NOT NULL AND w.review_due_at < NOW() AND w.response_status <> 'completed') AS overdue
     FROM mpdsr_workflows w
     JOIN death_notifications dn ON dn.notification_id=w.notification_id
     JOIN patients p ON p.patient_id=dn.patient_id
     JOIN facilities f ON f.facility_id=dn.facility_id
     ${scoped?"WHERE dn.facility_id=?":""}${scoped&&stageSql?" AND w.response_status=?":!scoped&&stageSql?" WHERE w.response_status=?":""}
     ORDER BY w.created_at DESC LIMIT 200`,
    [...(scoped?[req.user!.facilityId]:[]), ...(stageSql?[stage!]:[])])})
})
workflowsRouter.post("/mpdsr/workflows",clinical,async(req,res)=>{
  const d=z.object({notificationId:z.string().max(36),department:z.string().min(2).max(255).default("Maternal and Perinatal Review Team")}).parse(req.body)
  if(!await canAccessNotification(req.user!,d.notificationId))return res.status(403).json({error:"Record unavailable"})
  const [notification]=await query<any[]>("SELECT is_maternal_perinatal FROM death_notifications WHERE notification_id=?",[d.notificationId])
  if(!notification.is_maternal_perinatal)return res.status(400).json({error:"Select a maternal or perinatal notification"})
  const [existing]=await query<any[]>("SELECT workflow_id FROM mpdsr_workflows WHERE notification_id=?",[d.notificationId])
  if(existing)return res.status(409).json({error:"Workflow already exists"})
  const id=newId("mpd")
  await query(
    `INSERT INTO mpdsr_workflows (workflow_id,notification_id,initiated_by,department_notified,notification_timestamp,response_status,review_due_at)
     VALUES (?,?,?,?,NOW(),'notified',NOW()+INTERVAL '7 days')`,
    [id,d.notificationId,req.user!.userId,d.department])
  await writeAudit(req,{action:"initiate_mpdsr",entityType:"mpdsr_workflows",entityId:id})
  res.status(201).json({workflowId:id})
})
workflowsRouter.get("/mpdsr/workflows/:id",clinical,async(req,res)=>{
  const [w]=await query<any[]>(
    `SELECT w.*, p.full_name AS patient_name, f.facility_name, f.district, dn.date_of_death
     FROM mpdsr_workflows w
     JOIN death_notifications dn ON dn.notification_id=w.notification_id
     JOIN patients p ON p.patient_id=dn.patient_id
     JOIN facilities f ON f.facility_id=dn.facility_id
     WHERE w.workflow_id=?`,[req.params.id])
  if(!w||!await canAccessNotification(req.user!,w.notification_id))return res.status(403).json({error:"Record unavailable"})
  const actions=await query<any[]>("SELECT * FROM mpdsr_actions WHERE workflow_id=? ORDER BY created_at",[req.params.id])
  res.json({workflow:w,actions})
})
workflowsRouter.patch("/mpdsr/workflows/:id",clinical,async(req,res)=>{
  const d=z.object({
    stage:z.enum(MPDSR_STAGES).optional(),
    notes:z.string().max(16000).optional(),
    reviewPanel:z.string().max(500).optional(),
    reviewDate:z.string().max(40).optional(),
    causeClassification:z.enum(MPDSR_CAUSES).optional(),
    preventability:z.enum(MPDSR_PREVENTABILITY).optional(),
    contributingFactors:z.array(z.string().max(200)).max(20).optional(),
  }).parse(req.body)
  const [w]=await query<any[]>("SELECT * FROM mpdsr_workflows WHERE workflow_id=?",[req.params.id])
  if(!w||!await canAccessNotification(req.user!,w.notification_id))return res.status(403).json({error:"Record unavailable"})

  const updates:string[]=[],params:any[]=[]
  const set=(col:string,val:unknown)=>{updates.push(`${col}=?`);params.push(val)}

  if(d.stage&&d.stage!==w.response_status){
    const allowed=NEXT_STAGE[w.response_status]??[]
    if(!allowed.includes(d.stage))return res.status(400).json({error:`Cannot move from ${w.response_status} to ${d.stage}`})
    const cause=d.causeClassification??w.cause_classification
    const prev=d.preventability??w.preventability
    // Findings must be recorded before the committee can assign actions or close.
    if(d.stage!=="in_review"&&(!cause||!prev))
      return res.status(400).json({error:"Record cause classification and preventability first"})
    if(d.stage==="in_review"){if(!w.reviewed_at)set("reviewed_at",d.reviewDate??new Date())}
    if(d.stage==="completed"){
      const [{c:open}]=await query<any[]>("SELECT COUNT(*) c FROM mpdsr_actions WHERE workflow_id=? AND status='open'",[req.params.id])
      if(Number(open)>0)return res.status(400).json({error:`${open} corrective action(s) still open — mark them done or cancelled first`})
      set("completed_at",new Date())
    }
    set("response_status",d.stage)
  }
  if(d.notes!==undefined)set("investigation_notes",d.notes)
  if(d.reviewPanel!==undefined)set("review_panel",d.reviewPanel)
  if(d.reviewDate!==undefined&&!w.reviewed_at)set("reviewed_at",d.reviewDate)
  if(d.causeClassification!==undefined)set("cause_classification",d.causeClassification)
  if(d.preventability!==undefined)set("preventability",d.preventability)
  if(d.contributingFactors!==undefined)set("contributing_factors",JSON.stringify(d.contributingFactors))
  if(!updates.length)return res.status(400).json({error:"Nothing to update"})
  await query(`UPDATE mpdsr_workflows SET ${updates.join(",")} WHERE workflow_id=?`,[...params,req.params.id])
  await writeAudit(req,{action:"update_mpdsr",entityType:"mpdsr_workflows",entityId:req.params.id,details:d})
  res.json({ok:true})
})
workflowsRouter.post("/mpdsr/workflows/:id/actions",clinical,async(req,res)=>{
  const d=z.object({text:z.string().min(2).max(500),responsible:z.string().max(255).optional(),dueDate:z.string().max(20).optional()}).parse(req.body)
  const [w]=await query<any[]>("SELECT notification_id,response_status FROM mpdsr_workflows WHERE workflow_id=?",[req.params.id])
  if(!w||!await canAccessNotification(req.user!,w.notification_id))return res.status(403).json({error:"Record unavailable"})
  if(w.response_status==="notified"||w.response_status==="completed")
    return res.status(400).json({error:"Actions can only be added during or after review"})
  const id=newId("mpa")
  await query("INSERT INTO mpdsr_actions (action_id,workflow_id,action_text,responsible_party,due_date,created_by) VALUES (?,?,?,?,?,?)",
    [id,req.params.id,d.text,d.responsible??null,d.dueDate??null,req.user!.userId])
  await writeAudit(req,{action:"add_mpdsr_action",entityType:"mpdsr_actions",entityId:id})
  res.status(201).json({actionId:id})
})
workflowsRouter.patch("/mpdsr/actions/:id",clinical,async(req,res)=>{
  const d=z.object({status:z.enum(["done","cancelled"])}).parse(req.body)
  const [a]=await query<any[]>(
    `SELECT a.action_id,a.status,w.notification_id FROM mpdsr_actions a JOIN mpdsr_workflows w ON w.workflow_id=a.workflow_id WHERE a.action_id=?`,[req.params.id])
  if(!a||!await canAccessNotification(req.user!,a.notification_id))return res.status(403).json({error:"Record unavailable"})
  if(a.status!=="open")return res.status(400).json({error:"Action already closed"})
  await query("UPDATE mpdsr_actions SET status=?,completed_by=?,completed_at=NOW() WHERE action_id=?",[d.status,req.user!.userId,req.params.id])
  await writeAudit(req,{action:"resolve_mpdsr_action",entityType:"mpdsr_actions",entityId:req.params.id,details:d})
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
  res.json({items:await query(`SELECT c.*,f.district,p.full_name AS patient_name,dn.preliminary_icd_code FROM cross_border_cases c JOIN death_notifications dn ON dn.notification_id=c.notification_id JOIN patients p ON p.patient_id=dn.patient_id JOIN facilities f ON f.facility_id=dn.facility_id ${facilityScoped(req.user!)?"WHERE dn.facility_id=?":""} ORDER BY c.created_at DESC LIMIT 200`,facilityScoped(req.user!)?[req.user!.facilityId]:[])})
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
