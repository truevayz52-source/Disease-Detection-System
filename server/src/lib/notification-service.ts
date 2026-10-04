import crypto from "node:crypto"
import { z } from "zod"
import type { Request } from "express"
import { getPool, newId } from "../db.js"
import { facilityScoped } from "./access.js"
import { writeAudit } from "./audit.js"
import { checkMpdsr, detectOutbreaksCoalesced } from "./outbreak.js"

export const notificationSchema=z.object({
  submissionId:z.string().uuid().optional(),
  patient:z.object({nationalId:z.string().max(60).nullable().optional(),fullName:z.string().trim().min(2).max(255),age:z.number().int().min(0).max(150).nullable().optional(),gender:z.enum(["male","female","other"]),residentialAddress:z.string().max(512).nullable().optional(),latitude:z.number().min(-90).max(90).nullable().optional(),longitude:z.number().min(-180).max(180).nullable().optional()}),
  facilityId:z.string().min(1).max(36),dateOfDeath:z.string().refine(v=>Number.isFinite(Date.parse(v)) && Date.parse(v)<=Date.now(),"Invalid or future date of death"),preliminaryIcdCode:z.string().min(1).max(12),clinicalSummary:z.string().max(8000).nullable().optional(),isMaternalPerinatal:z.boolean().default(false)
})
export function httpError(status: number,message: string) { return Object.assign(new Error(message),{status}) }
export async function createNotification(req: Request, input: unknown) {
  const d=notificationSchema.parse(input), user=req.user!
  if(!["medical_officer","mortuary_clerk","public_health_analyst","system_admin"].includes(user.role))throw httpError(403,"Forbidden")
  if(facilityScoped(user)&&!user.facilityId)throw httpError(403,"No facility assigned")
  if(user.role==="mortuary_clerk" && d.clinicalSummary)throw httpError(403,"Clerks cannot record clinical findings")
  const facilityId=facilityScoped(user)?user.facilityId!:d.facilityId
  const hash=crypto.createHash("sha256").update(JSON.stringify({...d,submissionId:undefined,facilityId})).digest("hex")
  const key=d.submissionId?`${user.userId}:${d.submissionId}`:null
  const conn=await getPool().getConnection(),notificationId=newId("dn")
  let patientId:string|null=null
  try {
    await conn.beginTransaction()
    if(key) {
      await conn.query("INSERT IGNORE INTO notification_submissions (submission_id,user_id,payload_hash) VALUES (?,?,?)",[key,user.userId,hash])
      const [rows]=await conn.query<any[]>("SELECT * FROM notification_submissions WHERE submission_id=? FOR UPDATE",[key])
      if(rows[0].payload_hash!==hash)throw httpError(409,"Submission changed after it was queued. Keep the original or submit as a new record.")
      if(rows[0].notification_id){await conn.commit();return {notificationId:rows[0].notification_id,replayed:true,mpdsrAlertId:null,alertsCreated:[]}}
    }
    const [facilities]=await conn.query<any[]>("SELECT facility_id FROM facilities WHERE facility_id=?",[facilityId])
    const [codes]=await conn.query<any[]>("SELECT icd_code FROM icd_codes WHERE icd_code=?",[d.preliminaryIcdCode])
    if(!facilities.length||!codes.length)throw httpError(400,"Unknown facility or ICD code")
    // Reuse the patient row for a known national ID — repeat notifications
    // (facility + mortuary, corrected re-report) shouldn't fork identity.
    // Demographics are not overwritten on match.
    if(d.patient.nationalId){const [existing]=await conn.query<any[]>("SELECT patient_id FROM patients WHERE national_id=? LIMIT 1",[d.patient.nationalId]);patientId=existing[0]?.patient_id??null}
    if(!patientId){patientId=newId("pat");await conn.query("INSERT INTO patients (patient_id,national_id,full_name,age,gender,residential_address,latitude,longitude) VALUES (?,?,?,?,?,?,?,?)",[patientId,d.patient.nationalId??null,d.patient.fullName,d.patient.age??null,d.patient.gender,d.patient.residentialAddress??null,d.patient.latitude??null,d.patient.longitude??null])}
    await conn.query("INSERT INTO death_notifications (notification_id,patient_id,facility_id,date_of_death,preliminary_icd_code,clinical_summary,reported_by,is_maternal_perinatal) VALUES (?,?,?,?,?,?,?,?)",[notificationId,patientId,facilityId,new Date(d.dateOfDeath),d.preliminaryIcdCode,d.clinicalSummary??null,user.userId,d.isMaternalPerinatal])
    if(key)await conn.query("UPDATE notification_submissions SET notification_id=? WHERE submission_id=?",[notificationId,key])
    if(d.isMaternalPerinatal)await conn.query("INSERT INTO mpdsr_workflows (workflow_id,notification_id,initiated_by,department_notified,notification_timestamp) VALUES (?,?,?,'Maternal and Perinatal Review Team',NOW())",[newId("mpd"),notificationId,user.userId])
    await conn.commit()
  } catch(error) {await conn.rollback();throw error} finally {conn.release()}
  await writeAudit(req,{action:"create_death_notification",entityType:"death_notifications",entityId:notificationId,details:{patientId,facilityId}})
  const mpdsrAlertId=d.isMaternalPerinatal?await checkMpdsr(notificationId):null
  const alertsCreated=await detectOutbreaksCoalesced().catch(()=>[])
  return {notificationId,patientId,mpdsrAlertId,alertsCreated}
}
