import { Router } from "../lib/router.js"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query,newId } from "../db.js"
import { z } from "zod"
import { writeAudit } from "../lib/audit.js"
export const reportsRouter=Router()
reportsRouter.use(requireAuth,requireRole("public_health_analyst","system_admin","executive"))
reportsRouter.get("/available",(_req,res)=>res.json({items:[{id:"mortality",name:"District mortality summary"}],formats:["csv","json"]}))
reportsRouter.get("/scheduled",async(req,res)=>res.json({items:await query("SELECT * FROM scheduled_reports WHERE created_by=? ORDER BY created_at DESC",[req.user!.userId])}))
reportsRouter.post("/schedule",async(req,res)=>{
  const d=z.object({name:z.string().min(2).max(255),days:z.number().int().min(1).max(366),intervalHours:z.union([z.literal(24),z.literal(168)]),emailNotification:z.boolean().default(false)}).parse(req.body)
  const id=newId("rep")
  await query("INSERT INTO scheduled_reports (report_id,created_by,report_name,report_type,schedule_config,recipients,next_run_at) VALUES (?,?,?,'mortality',?,'[]',NOW())",[id,req.user!.userId,d.name,JSON.stringify({days:d.days,intervalHours:d.intervalHours,emailNotification:d.emailNotification})])
  await writeAudit(req,{action:"schedule_report",entityType:"scheduled_reports",entityId:id});res.status(201).json({id})
})
reportsRouter.patch("/scheduled/:id",async(req,res)=>{
  const d=z.object({active:z.boolean()}).parse(req.body)
  const r=await query<any>("UPDATE scheduled_reports SET is_active=? WHERE report_id=? AND created_by=?",[d.active,req.params.id,req.user!.userId])
  if(!r.affectedRows)return res.status(404).json({error:"Schedule not found"})
  await writeAudit(req,{action:"update_report_schedule",entityType:"scheduled_reports",entityId:req.params.id});res.json({ok:true})
})
reportsRouter.delete("/scheduled/:id",async(req,res)=>{
  await query("DELETE FROM scheduled_reports WHERE report_id=? AND created_by=?",[req.params.id,req.user!.userId])
  await writeAudit(req,{action:"delete_report_schedule",entityType:"scheduled_reports",entityId:req.params.id});res.json({ok:true})
})
reportsRouter.get("/runs",async(req,res)=>res.json({items:await query("SELECT run_id,report_id,created_at FROM report_runs WHERE owner_id=? ORDER BY created_at DESC LIMIT 100",[req.user!.userId])}))
reportsRouter.get("/runs/:id",async(req,res)=>{
  const [row]=await query<any[]>("SELECT report_data FROM report_runs WHERE run_id=? AND owner_id=?",[req.params.id,req.user!.userId])
  if(!row)return res.status(404).json({error:"Report not found"})
  await writeAudit(req,{action:"download_scheduled_report",entityType:"report_runs",entityId:req.params.id})
  res.json(typeof row.report_data==="string"?JSON.parse(row.report_data):row.report_data)
})
export function csvCell(value: unknown) {
  let s=String(value??"")
  if(/^[\s]*[=+@-]/.test(s))s="'"+s
  return '"'+s.replaceAll('"','""')+'"'
}
reportsRouter.post("/generate",async(req,res)=>{
  const d=z.object({format:z.enum(["csv","json"]),days:z.number().int().min(1).max(366).default(30)}).parse(req.body)
  const rows=await query<any[]>("SELECT f.district,ic.disease_category,COUNT(*) AS deaths,SUM(dn.is_maternal_perinatal) AS maternal_perinatal FROM death_notifications dn JOIN facilities f ON f.facility_id=dn.facility_id JOIN icd_codes ic ON ic.icd_code=dn.preliminary_icd_code WHERE dn.date_of_death>=DATE_SUB(NOW(),INTERVAL ? DAY) GROUP BY f.district,ic.disease_category ORDER BY f.district",[d.days])
  await writeAudit(req,{action:"export_report",entityType:"reports",details:{format:d.format,days:d.days,rows:rows.length}})
  res.setHeader("Cache-Control","no-store")
  res.setHeader("Content-Disposition",`attachment; filename="dds-mortality.${d.format}"`)
  if(d.format==="json")return res.json({generatedAt:new Date().toISOString(),days:d.days,items:rows})
  const keys=["district","disease_category","deaths","maternal_perinatal"]
  res.type("text/csv").send([keys.map(csvCell).join(","),...rows.map(r=>keys.map(k=>csvCell(r[k])).join(","))].join("\r\n"))
})
