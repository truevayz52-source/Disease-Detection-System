import { Router } from "../lib/router.js"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query, newId } from "../db.js"
import { z } from "zod"
import { writeAudit, verifyAuditChain } from "../lib/audit.js"
import { canAccessNotification, facilityScoped } from "../lib/access.js"
import { pythonHealth } from "../lib/analyticsClient.js"
import multer from "multer"
import path from "node:path"
import { readFile } from "node:fs/promises"
import { config } from "../config.js"
import { emailConfigured } from "../lib/email.js"
import { pathologyResult, serviceJson, unavailable, whoConfigured } from "../lib/integrations.js"
import { dhis2Configured, forwardToOpenhim, openhimConfigured, pushToDhis2, regionalStatus } from "../lib/regional-bridge.js"
import { SUPPORTED_LANGUAGES } from "../lib/languages.js"
import { translateConfigured } from "./translate.js"

export const operationsRouter = Router()
operationsRouter.use(["/settings","/security","/integrations","/search","/analytics/districts","/forecasts","/voice","/ai","/regional"],requireAuth)
const admin = requireRole("system_admin")
const analysis = requireRole("public_health_analyst","executive")
operationsRouter.get("/settings/public",async(_req,res)=>res.json({name:"Disease Detection System",languages:SUPPORTED_LANGUAGES,timezone:"Africa/Harare"}))
operationsRouter.get("/settings/all",admin,async(_req,res)=>res.json({items:await query("SELECT * FROM system_settings ORDER BY setting_key")}))
const settingsSchema=z.object({site_notice:z.string().max(1000),maintenance_message:z.string().max(1000)}).partial()
operationsRouter.patch("/settings/:key",admin,async(req,res)=>{
  if(!["site_notice","maintenance_message"].includes(req.params.key))return res.status(400).json({error:"Unknown setting"})
  const d=settingsSchema.parse({[req.params.key]:req.body.value}) as Record<string,unknown>
  if(d[req.params.key]===undefined)return res.status(400).json({error:"Setting value is required"})
  await query("INSERT INTO system_settings (setting_id,setting_key,setting_value,updated_by) VALUES (?,?,?,?) ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_by=EXCLUDED.updated_by",[newId("set"),req.params.key,JSON.stringify(d[req.params.key]),req.user!.userId])
  await writeAudit(req,{action:"update_setting",entityType:"system_settings",entityId:req.params.key});res.json({ok:true})
})
operationsRouter.get("/security/overview",admin,async(_req,res)=>{
  const sessions=await query("SELECT s.session_id,s.ip_address,s.user_agent,s.created_at,s.expires_at,u.full_name FROM sessions s JOIN users u ON u.user_id=s.user_id WHERE NOT revoked AND expires_at>NOW() ORDER BY created_at DESC LIMIT 200")
  const locked=await query("SELECT user_id,full_name,email,failed_login_attempts,locked_until FROM users WHERE locked_until>NOW()")
  const events=await query("SELECT action,user_id,ip_address,created_at,session_id FROM audit_log WHERE action LIKE 'login_failed%' OR action LIKE '%2fa%' ORDER BY chain_sequence DESC LIMIT 100")
  res.json({sessions,locked,events,integrity:await verifyAuditChain()})
})
operationsRouter.post("/security/unlock/:id",admin,async(req,res)=>{
  await query("UPDATE users SET failed_login_attempts=0,locked_until=NULL WHERE user_id=?",[req.params.id])
  await writeAudit(req,{action:"unlock_account",entityType:"users",entityId:req.params.id});res.json({ok:true})
})
operationsRouter.get("/integrations/status",admin,async(_req,res)=>res.json({analytics:await pythonHealth(),pathologyModel:process.env.PATHOLOGY_INFERENCE_URL?"configured; availability checked on use":"not_configured",whisper:process.env.WHISPER_URL?"configured; availability checked on use":"not_configured",whoCatalog:whoConfigured()?"ICD-11 lookup configured; local ICD-10 retained":"local ICD-10; WHO credentials/release not configured",regionalBridge:regionalStatus(),email:emailConfigured()?"SMTP configured; delivery checked on use":"not_configured",translation:translateConfigured()?"Gemini configured; requests are de-identified before dispatch":"not_configured — offline glossary fallback only",audit:"SHA-256 hash chain; not a distributed blockchain"}))
operationsRouter.get("/search/global",requireRole("medical_officer","mortuary_clerk","pathologist","public_health_analyst"),async(req,res)=>{
  const q=z.string().min(2).max(100).parse(req.query.q),like=`%${q}%`
  res.json({items:await query(`SELECT dn.notification_id,p.full_name,f.facility_name,dn.status FROM death_notifications dn JOIN patients p ON p.patient_id=dn.patient_id JOIN facilities f ON f.facility_id=dn.facility_id WHERE (p.full_name LIKE ? OR p.national_id LIKE ? OR dn.notification_id LIKE ?) ${facilityScoped(req.user!)?"AND dn.facility_id=?":""} ORDER BY dn.created_at DESC LIMIT 50`,[like,like,like,...facilityScoped(req.user!)?[req.user!.facilityId]:[]])})
})
operationsRouter.get("/analytics/districts",analysis,async(_req,res)=>{
  res.json({items:await query("SELECT f.district,ic.disease_category,COUNT(*) AS deaths,COUNT(*) FILTER (WHERE dn.status IN ('pending_review','under_review')) AS pending,COUNT(*) FILTER (WHERE dn.is_maternal_perinatal) AS maternal_perinatal FROM death_notifications dn JOIN facilities f ON f.facility_id=dn.facility_id JOIN icd_codes ic ON ic.icd_code=dn.preliminary_icd_code WHERE dn.status<>'rejected' AND dn.date_of_death>=NOW()-INTERVAL '30 days' GROUP BY f.district,ic.disease_category ORDER BY deaths DESC")})
})
// Live expected-caseload view: last-28-day reporting rate scaled to the
// requested window — no stored snapshot needed to look at it.
operationsRouter.get("/forecasts",analysis,async(req,res)=>{
  const days=Math.min(30,Math.max(1,Number(req.query.days)||7))
  const items=await query<any[]>(`SELECT f.district,ic.disease_category,COUNT(*)::int AS observed_28d,CEIL(COUNT(*)::numeric*?/28)::int AS predicted_cases FROM death_notifications dn JOIN facilities f ON f.facility_id=dn.facility_id JOIN icd_codes ic ON ic.icd_code=dn.preliminary_icd_code WHERE dn.status<>'rejected' AND dn.date_of_death>=NOW()-INTERVAL '28 days' GROUP BY f.district,ic.disease_category ORDER BY predicted_cases DESC,f.district`,[days])
  res.json({items:items.map(r=>({...r,forecast_horizon_days:days})),days,method:"28-day reporting rate"})
})
operationsRouter.post("/forecasts/generate",requireRole("public_health_analyst"),async(req,res)=>{
  const d=z.object({days:z.number().int().min(1).max(30).default(7)}).parse(req.body)
  const groups=await query<any[]>("SELECT f.district,ic.disease_category,COUNT(*) AS n FROM death_notifications dn JOIN facilities f ON f.facility_id=dn.facility_id JOIN icd_codes ic ON ic.icd_code=dn.preliminary_icd_code WHERE dn.status<>'rejected' AND dn.date_of_death>=NOW()-INTERVAL '28 days' GROUP BY f.district,ic.disease_category")
  for(const g of groups)await query("INSERT INTO resource_forecasts (forecast_id,district,disease_category,forecast_horizon_days,predicted_cases,recommended_supplies,forecast_target_date) VALUES (?,?,?,?,?,?,NOW()+(?*INTERVAL '1 day'))",[newId("fc"),g.district,g.disease_category,d.days,Math.ceil(g.n/28*d.days),JSON.stringify({method:"28-day mortality reporting rate",observations:g.n,planningNote:"Forecasts death notifications, not infections or clinical supply requirements. No validated supply ratios are configured."}),d.days])
  await writeAudit(req,{action:"generate_forecasts",entityType:"resource_forecasts",details:{days:d.days}});res.json({created:groups.length,method:"historical-rate baseline"})
})
const audioUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:20*1024*1024,files:1,fields:2}})
operationsRouter.get("/voice/status",requireRole("medical_officer","mortuary_clerk"),(_req,res)=>res.json({configured:Boolean(process.env.WHISPER_URL)}))
async function requireVoiceCase(req: import("express").Request, res: import("express").Response, id:string) {
  const [row]=await query<any[]>("SELECT facility_id FROM death_notifications WHERE notification_id=?",[id])
  if(!row){res.status(404).json({error:"Notification not found. Select an existing case from the list."});return false}
  if(facilityScoped(req.user!)&&(!req.user!.facilityId||row.facility_id!==req.user!.facilityId)){
    res.status(403).json({error:"This case belongs to another facility. Select a case assigned to your facility."});return false
  }
  return true
}
operationsRouter.post("/voice/transcribe",requireRole("medical_officer","mortuary_clerk"),audioUpload.single("file"),async(req,res)=>{
  const d=z.object({notificationId:z.string().trim().min(1).max(36),language:z.enum(["en","sn","nd"])}).parse(req.body)
  if(!await requireVoiceCase(req,res,d.notificationId))return
  if(!process.env.WHISPER_URL)throw unavailable("Whisper service is not configured. Use editable manual transcription.")
  if(!req.file||!["audio/wav","audio/x-wav","audio/wave","audio/mpeg","audio/mp3","audio/mp4","audio/x-m4a","audio/webm","video/webm","audio/ogg","application/ogg"].includes(req.file.mimetype))return res.status(400).json({error:"Upload WAV, MP3, M4A, WebM or Ogg audio up to 20 MB"})
  const body=new FormData();body.append("file",new Blob([new Uint8Array(req.file.buffer)],{type:req.file.mimetype}),"interview");body.append("language",d.language)
  const parsed=z.object({text:z.string().max(16000)}).safeParse(await serviceJson(process.env.WHISPER_URL,{method:"POST",body,headers:process.env.WHISPER_API_KEY?{Authorization:`Bearer ${process.env.WHISPER_API_KEY}`}:{}}))
  if(!parsed.success)throw unavailable("Transcription service returned an invalid result")
  await writeAudit(req,{action:"transcribe_audio",entityType:"death_notifications",entityId:d.notificationId})
  res.json({text:parsed.data.text,requiresReview:true})
})
operationsRouter.post("/voice/save",requireRole("medical_officer","mortuary_clerk"),async(req,res)=>{
  const d=z.object({notificationId:z.string().trim().min(1).max(36),text:z.string().min(1).max(16000),language:z.enum(["en","sn","nd"])}).parse(req.body)
  if(!await requireVoiceCase(req,res,d.notificationId))return
  const id=newId("voice")
  await query("INSERT INTO voice_transcriptions (transcription_id,notification_id,user_id,transcription_text,language,processed_at) VALUES (?,?,?,?,?,NOW())",[id,d.notificationId,req.user!.userId,d.text,d.language])
  await query("UPDATE death_notifications SET verbal_autopsy_data=? WHERE notification_id=?",[JSON.stringify({text:d.text,language:d.language,source:"user_reviewed_transcript"}),d.notificationId])
  await writeAudit(req,{action:"save_verbal_autopsy",entityType:"death_notifications",entityId:d.notificationId});res.status(201).json({id})
})
operationsRouter.post("/ai/pathology/analyze",requireRole("pathologist"),async(req,res)=>{
  const {imageId}=z.object({imageId:z.string().min(1).max(36)}).parse(req.body)
  const [image]=await query<any[]>("SELECT * FROM tele_pathology_images WHERE image_id=?",[imageId])
  if(!image||!await canAccessNotification(req.user!,image.notification_id,true))return res.status(403).json({error:"Image unavailable"})
  if(!process.env.PATHOLOGY_INFERENCE_URL)throw unavailable("No pathology model is configured. Manual review remains available.")
  const filename=path.resolve(config.uploadsDir,"..",image.file_path),relative=path.relative(config.uploadsDir,filename)
  if(relative.startsWith("..")||path.isAbsolute(relative))throw Error("Invalid stored image path")
  const body=new FormData();body.append("file",new Blob([new Uint8Array(await readFile(filename))],{type:image.mime_type}),"specimen")
  const parsed=pathologyResult.safeParse(await serviceJson(process.env.PATHOLOGY_INFERENCE_URL,{method:"POST",body,headers:process.env.PATHOLOGY_API_KEY?{Authorization:`Bearer ${process.env.PATHOLOGY_API_KEY}`}:{}}))
  if(!parsed.success)throw unavailable("Pathology service returned an invalid result")
  const result=parsed.data,id=newId("ai")
  await query("INSERT INTO ai_pathology_analysis (analysis_id,image_id,notification_id,model_version,anomaly_score,anomaly_regions,confidence_score) VALUES (?,?,?,?,?,?,?)",[id,imageId,image.notification_id,result.modelVersion,result.anomalyScore,JSON.stringify(result.regions),result.confidenceScore])
  await writeAudit(req,{action:"analyze_pathology",entityType:"tele_pathology_images",entityId:imageId,details:{modelVersion:result.modelVersion}})
  res.status(201).json({id,...result,requiresReview:true})
})
operationsRouter.get("/ai/pathology/results/:imageId",requireRole("pathologist"),async(req,res)=>{
  const [image]=await query<any[]>("SELECT notification_id FROM tele_pathology_images WHERE image_id=?",[req.params.imageId])
  if(!image||!await canAccessNotification(req.user!,image.notification_id,true))return res.status(403).json({error:"Image unavailable"})
  res.json({items:await query("SELECT * FROM ai_pathology_analysis WHERE image_id=? ORDER BY analysis_timestamp DESC",[req.params.imageId])})
})

// Push the district-level mortality aggregate to the configured regional
// exchange targets (DHIS2 dataValueSets / OpenHIM FHIR channel). Counts
// only — no case-level data leaves this API.
operationsRouter.post("/regional/push",requireRole("public_health_analyst"),async(req,res)=>{
  const days=z.number().int().min(1).max(365).default(30).parse(req.body?.days)
  const targets:{name:string;ok:boolean;detail?:unknown}[]=[]
  if(dhis2Configured()){
    try{targets.push({name:"dhis2",ok:true,detail:await pushToDhis2(days)})}
    catch(e){targets.push({name:"dhis2",ok:false,detail:String((e as Error).message)})}
  }
  if(openhimConfigured()){
    try{targets.push({name:"openhim",ok:true,detail:await forwardToOpenhim(days)})}
    catch(e){targets.push({name:"openhim",ok:false,detail:String((e as Error).message)})}
  }
  if(!targets.length)throw unavailable("No regional bridge target is configured (DHIS2_* or OPENHIM_*)")
  await writeAudit(req,{action:"regional_push",entityType:"regional_bridge",entityId:`${days}d`,details:{targets:targets.map(t=>({name:t.name,ok:t.ok}))}})
  res.status(targets.every(t=>t.ok)?201:502).json({days,targets})
})
