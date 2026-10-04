import { getPool,newId } from "../db.js"
import { events } from "../websocket/index.js"
import { sendEmail, emailConfigured } from "./email.js"
import { config } from "../config.js"
export async function runScheduledReports(){
  const connection=await getPool().getConnection()
  let locked=false
  try{
    const [lock]=await connection.query<any[]>("SELECT GET_LOCK('dds_scheduled_reports',0) AS acquired")
    if(!lock[0]?.acquired)return
    locked=true
    const [due]=await connection.query<any[]>("SELECT r.*,u.email AS owner_email FROM scheduled_reports r JOIN users u ON u.user_id=r.created_by WHERE r.is_active=1 AND r.next_run_at<=NOW() AND u.status='active' AND u.role IN ('public_health_analyst','system_admin','executive') ORDER BY next_run_at LIMIT 20")
    for(const report of due){
      const schedule=typeof report.schedule_config==="string"?JSON.parse(report.schedule_config):report.schedule_config
      if(![24,168].includes(schedule.intervalHours)||!Number.isInteger(schedule.days)||schedule.days<1||schedule.days>366)continue
      await connection.beginTransaction()
      const [rows]=await connection.query<any[]>("SELECT f.district,ic.disease_category,COUNT(*) AS deaths FROM death_notifications dn JOIN facilities f ON f.facility_id=dn.facility_id JOIN icd_codes ic ON ic.icd_code=dn.preliminary_icd_code WHERE dn.date_of_death>=DATE_SUB(NOW(),INTERVAL ? DAY) GROUP BY f.district,ic.disease_category",[schedule.days])
      await connection.query("INSERT INTO report_runs (run_id,report_id,owner_id,report_data) VALUES (?,?,?,?)",[newId("run"),report.report_id,report.created_by,JSON.stringify({name:report.report_name,days:schedule.days,generatedAt:new Date().toISOString(),items:rows})])
      await connection.query("UPDATE scheduled_reports SET last_run_at=NOW(),next_run_at=DATE_ADD(NOW(),INTERVAL ? HOUR) WHERE report_id=?",[schedule.intervalHours,report.report_id])
      await connection.query("INSERT INTO user_notifications (notification_id,user_id,notification_type,title,message,action_url) VALUES (?,?,'report','Scheduled report ready',?,'/reports')",[newId("msg"),report.created_by,`${report.report_name} is ready to download.`])
      await connection.commit();events.emit("inbox",report.created_by)
      if(schedule.emailNotification===true&&emailConfigured()) {
        try { await sendEmail(report.owner_email,"Your DDS report is ready",`Your scheduled report is ready. Sign in to ${config.clientOrigin}/reports to download it.`) }
        catch { console.error("[reports] email notification failed; report remains available in the application") }
      }
    }
  }catch(error){await connection.rollback();console.error("[reports] scheduled report generation failed",error instanceof Error?error.message:"unknown error")}
  finally{if(locked)await connection.query("SELECT RELEASE_LOCK('dds_scheduled_reports')");connection.release()}
}
