import { ScheduledReports } from "@/components/scheduled-reports"
import { AudioTranscription } from "@/components/inference-tools"
import { useState,useRef,useEffect } from "react"
import { Link } from "react-router-dom"
import useSWR from "swr"
import { api } from "@/lib/api"

import { Workspace,Panel,Field,Action,Rows,LoadState } from "@/components/workspace"
import { StatCard } from "@/components/stat-card"
import { Activity, AlertTriangle, Baby, ClipboardList, FileCheck, Hourglass } from "lucide-react"
import { toast } from "sonner"
import { usePreferences } from "@/lib/preferences"
import { TranslatedBlock } from "@/components/translated-block"
import { aiExtract } from "@/lib/ai"
import { Sparkles, Loader2 } from "lucide-react"

const VA_FIELD_LABELS: [string, string][] = [
  ["full_name", "Full name"], ["age_years", "Age (years)"], ["gender", "Gender"],
  ["date_of_death", "Date of death"], ["place_of_death", "Place of death"],
  ["address", "Address"], ["circumstances", "Circumstances"], ["symptoms", "Symptoms"],
  ["suspected_cause", "Suspected cause"], ["suggested_icd10", "Suggested ICD-10"],
  ["maternal_or_perinatal", "Maternal / perinatal"],
]

// Suggests death-notification fields from a reviewed verbal-autopsy transcript.
// The transcript leaves the client already masked with ⟦n⟧ PII tokens; the
// server re-verifies masking before the provider sees anything.
function VoiceExtract({ text, pii }: { text: string; pii: (string | null | undefined)[] }) {
  const { t } = usePreferences()
  const [fields, setFields] = useState<Record<string, unknown> | null>(null)
  const [pending, setPending] = useState(false)
  if (!text.trim()) return null
  const extract = async () => {
    setPending(true)
    try { setFields(await aiExtract(text, { pii })) }
    catch (e) { toast.error(e instanceof Error ? e.message : t("AI extraction failed")) }
    finally { setPending(false) }
  }
  return (
    <div className="space-y-2">
      <Action variant="outline" onClick={extract} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
        {pending ? t("Extracting…") : t("Extract structured fields with AI")}
      </Action>
      {fields && (
        <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
            {VA_FIELD_LABELS.map(([key, label]) => {
              const v = fields[key]
              if (v === null || v === undefined || v === "") return null
              return (
                <div key={key} className="flex gap-2">
                  <dt className="min-w-28 shrink-0 text-muted-foreground">{t(label)}</dt>
                  <dd className="font-medium">{Array.isArray(v) ? v.join(", ") : v === true ? t("Yes") : v === false ? t("No") : String(v)}</dd>
                </div>
              )
            })}
          </dl>
          <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Sparkles className="size-3" />{t("AI-generated draft — verify each field against the transcript before copying into the record")}
          </p>
        </div>
      )}
    </div>
  )
}


export function ExecutivePage(){const{t}=usePreferences();const {data,error}=useSWR<any>("/analytics/summary",api),districts=useSWR<any>("/analytics/districts",api);return <Workspace title={t("Executive Overview")} description={t("Aggregate mortality surveillance. Individual patient records are excluded.")}><LoadState error={error}/><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[["deathsLast7Days","Deaths in 7 days",Activity,"rose"],["pendingReviews","Pending reviews",Hourglass,"amber"],["activeAlerts","Active alerts",AlertTriangle,"red"],["finalizedAutopsies","Finalized autopsies",FileCheck,"emerald"],["mpdsrLast30Days","Maternal / perinatal, 30 days",Baby,"purple"],["totalNotifications","Total notifications",ClipboardList,"blue"]].map(([key,label,icon,color])=><StatCard key={key as string} label={label as string} value={data?.[key as string]} icon={icon as any} color={color as any} pulse={key==="activeAlerts"&&(data?.activeAlerts??0)>0}/>)}</div><Panel title={t("District surveillance · last 30 days")}><LoadState error={districts.error}/>{districts.data&&<Rows items={districts.data.items} columns={[["district","District"],["disease_category","Category"],["deaths","Deaths"],["pending","Pending"],["maternal_perinatal","Maternal / perinatal"]]}/>}</Panel></Workspace>}
export function ForecastPage(){const{t}=usePreferences();const [days,setDays]=useState(7);const {data,error}=useSWR<any>(`/forecasts?days=${days}`,api);const items=data?.items??[];const total=items.reduce((a:number,r:any)=>a+Number(r.predicted_cases||0),0);
  return <Workspace title={t("Expected Caseload")} description={t("Expected death-notification volume per district over the chosen window — scaled from the last 28 days of reports, for HQ workload and capacity planning.")}>
    <Panel title={t("Planning horizon")}>
      <div className="flex flex-wrap gap-2">{[7,14,30].map(d=><button key={d} type="button" onClick={()=>setDays(d)} className={`rounded-md border px-3 py-1.5 text-sm ${d===days?"bg-primary text-primary-foreground":"hover:bg-muted"}`}>{d} {t("days")}</button>)}</div>
      <p className="text-xs text-muted-foreground">{t("How it works: the last 28 days of reported deaths are scaled to the selected window. These are expected notification counts for planning — not infection forecasts or supply requirements.")}</p>
    </Panel>
    {data&&items.length>0&&<p className="text-sm text-muted-foreground">{t(`About ${total} notification(s) expected nationwide over the next ${days} days.`)}</p>}
    <LoadState error={error} loading={!data&&!error} empty={items.length===0}/>
    {items.length>0&&<Rows items={items} columns={[["district","District"],["disease_category","Category"],["observed_28d","Reported (last 28 days)"],["predicted_cases",`Expected (next ${days} days)`]]}/>}
  </Workspace>}
export function ReportsPage(){const{t}=usePreferences();const [days,setDays]=useState("30");async function download(format:string){const result=await api("/reports/generate",{method:"POST",body:JSON.stringify({days:Number(days),format})});const url=URL.createObjectURL(new Blob([format==="json"?JSON.stringify(result,null,2):result],{type:format==="json"?"application/json":"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=`dds-mortality.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}return <Workspace title={t("Reports")} description={t("Export aggregate district mortality data. Every export is recorded in the audit trail.")}><Panel title={t("District mortality summary")}><Field label={t("Reporting window (days)")} value={days} onChange={setDays} type="number"/><div className="flex gap-3"><Action onClick={()=>download("csv")}>{t("Download CSV")}</Action><Action variant="outline" onClick={()=>download("json")}>{t("Download JSON")}</Action></div><p className="text-xs text-muted-foreground">{t("CSV files open in Excel. Death certificates can be printed to PDF from a finalized case.")}</p></Panel><ScheduledReports/></Workspace>}
export function SecurityPage(){const{t}=usePreferences();const {data,error,mutate}=useSWR<any>("/security/overview",api);return <Workspace title={t("Security Dashboard")} description={t("Account lockouts, live sessions and recent authentication events.")}><LoadState error={error}/><Panel title={t("Audit integrity")}><p className={data?.integrity.valid?"text-primary":"text-destructive"}>{data?data.integrity.valid?`Verified ${data.integrity.checked} records`:`Chain verification failed after ${data.integrity.checked} records`:"Checking…"}</p><Link className="text-sm underline" to="/audit">{t("Inspect audit trail")}</Link></Panel><Panel title={t("Locked accounts")}>{!data?.locked.length&&<p className="text-sm text-muted-foreground">{t("No locked accounts.")}</p>}{data?.locked.map((u:any)=><div className="flex items-center justify-between gap-3" key={u.user_id}><span className="text-sm">{u.full_name} • {u.email}</span><Action variant="outline" onClick={async()=>{await api(`/security/unlock/${u.user_id}`,{method:"POST"});mutate()}}>{t("Unlock")}</Action></div>)}</Panel>{data&&<><Panel title={t("Active sessions")}><Rows items={data.sessions} columns={[["full_name","User"],["ip_address","IP address"],["created_at","Signed in"],["expires_at","Expires"]]}/></Panel><Panel title={t("Security events")}><Rows items={data.events} columns={[["action","Event"],["ip_address","IP address"],["created_at","Time"]]}/></Panel></>}</Workspace>}
export function SettingsPage(){const{t}=usePreferences();const {data,error,mutate}=useSWR<any>("/settings/all",api),status=useSWR<any>("/integrations/status",api),[notice,setNotice]=useState("");return <Workspace title={t("System Settings")} description={t("Configure the application and inspect integration availability.")}><LoadState error={error}/><Panel title={t("Site notice")}><Field label={t("Notice")} value={notice} onChange={setNotice}/><Action onClick={async()=>{await api("/settings/site_notice",{method:"PATCH",body:JSON.stringify({value:notice})});mutate();toast.success(t("Setting saved"))}}>{t("Save notice")}</Action>{data?.items.map((s:any)=><p key={s.setting_key} className="text-sm">{s.setting_key}: {String(s.setting_value)}</p>)}</Panel><Panel title={t("Connected services")}><LoadState error={status.error}/>{status.data&&<Rows items={Object.entries(status.data).map(([service,value])=>({service,status:typeof value==="object"?JSON.stringify(value):value}))} columns={[["service","Service"],["status","Status"]]}/>}</Panel></Workspace>}
export function SearchPage(){const{t}=usePreferences();const [q,setQ]=useState(""),[query,setQuery]=useState(""),{data,error,isLoading}=useSWR<any>(query.length>=2?`/search/global?q=${encodeURIComponent(query)}`:null,api);return <Workspace title={t("Search")} description={t("Search cases by name, national ID or notification ID within your permitted scope.")}><form className="flex gap-3" onSubmit={e=>{e.preventDefault();setQuery(q)}}><input aria-label={t("Search cases")} className="min-w-0 flex-1 rounded-lg border bg-background p-3 text-sm" value={q} onChange={e=>setQ(e.target.value)} minLength={2}/><button className="rounded-lg bg-primary px-5 text-sm text-primary-foreground">{t("Search")}</button></form><LoadState error={error} loading={isLoading} empty={data?.items.length===0}/>{data?.items.map((r:any)=><Link className="block rounded-lg border bg-card p-4" to={`/notifications/${r.notification_id}`} key={r.notification_id}><p className="font-medium">{r.full_name}</p><p className="text-sm text-muted-foreground">{r.facility_name} • {r.status}</p></Link>)}</Workspace>}
export function VoicePage(){const{t}=usePreferences();const cases=useSWR<any>("/notifications",api);const [id,setId]=useState(""),[text,setText]=useState(""),[language,setLanguage]=useState("en");return <Workspace title={t("Verbal Autopsy")} description={t("Capture an editable interview transcript. Live transcription runs locally through the Whisper service — no audio leaves this machine; clinical review is required.")}><Panel title={t("Interview transcript")}><LoadState error={cases.error}/><label className="block text-sm">{t("Case")}<select className="mt-2 block w-full rounded border bg-background p-2" value={id} onChange={e=>setId(e.target.value)}><option value="">{t("Select an existing notification")}</option>{cases.data?.items.map((n:any)=><option key={n.notification_id} value={n.notification_id}>{n.patient_name} — {n.facility_name} — {n.notification_id}</option>)}</select></label><label className="block text-sm">{t("Language")}<select className="ml-3 rounded border bg-background p-2" value={language} onChange={e=>setLanguage(e.target.value)}><option value="en">{t("English")}</option><option value="sn">{t("Shona")}</option><option value="nd">{t("Ndebele")}</option></select></label><AudioTranscription notificationId={id} language={language} onText={value=>setText(t=>[t,value].filter(Boolean).join(" "))}/><label className="block text-sm">{t("Reviewed transcript")}<textarea className="mt-2 block min-h-52 w-full rounded border bg-background p-3" value={text} maxLength={16000} onChange={e=>setText(e.target.value)}/></label>{text&&<div className="rounded-md border border-dashed p-3"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Translated preview")}</p><TranslatedBlock text={text}/></div>}<VoiceExtract text={text} pii={[cases.data?.items.find((n:any)=>n.notification_id===id)?.patient_name, cases.data?.items.find((n:any)=>n.notification_id===id)?.national_id, cases.data?.items.find((n:any)=>n.notification_id===id)?.facility_name]}/><Action onClick={async()=>{await api("/voice/save",{method:"POST",body:JSON.stringify({notificationId:id,text,language})});toast.success(t("Transcript saved"))}}>{t("Save reviewed transcript")}</Action></Panel></Workspace>}



