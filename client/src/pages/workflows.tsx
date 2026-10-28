import { useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { Workspace, Panel, Field, Action, LoadState, Rows } from "@/components/workspace"
import { usePreferences } from "@/lib/preferences"
import { fmtDate } from "@/lib/format"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Baby, Clock, CheckCircle2, XCircle, Plus, Play, FileCheck, ListChecks } from "lucide-react"
const post = (url: string, body: unknown) => api(url, { method: "POST", body: JSON.stringify(body) })

const MPDSR_STAGES = ["notified", "in_review", "actions_assigned", "completed"] as const
type Stage = (typeof MPDSR_STAGES)[number]

function stageLabel(stage: string) {
  const labels: Record<string, string> = {
    notified: "Notified",
    in_review: "In review",
    actions_assigned: "Actions assigned",
    completed: "Completed",
  }
  return labels[stage] ?? stage
}

export function MpdsrPage() {
  const { t } = usePreferences()
  const [filter, setFilter] = useState<"all" | Stage>("all")
  const { data: queue, error: qErr, isLoading: qLoading, mutate: qMut } = useSWR<any>("/mpdsr/queue", api)
  const { data: wf, error, isLoading, mutate } = useSWR<any>(
    filter === "all" ? "/mpdsr/workflows" : `/mpdsr/workflows?stage=${filter}`,
    api,
  )
  const items = wf?.items ?? []
  const counts = {
    queue: queue?.items?.length ?? 0,
    notified: items.filter((w: any) => w.response_status === "notified").length,
    in_review: items.filter((w: any) => w.response_status === "in_review").length,
    actions: items.filter((w: any) => w.response_status === "actions_assigned").length,
    completed: items.filter((w: any) => w.response_status === "completed").length,
    overdue: items.filter((w: any) => w.overdue).length,
  }
  const stat = (label: string, value: number, color: string) => (
    <div key={label} className={`rounded-lg border p-3 ${color}`}>
      <p className="text-xs text-muted-foreground uppercase">{t(label)}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  )

  return (
    <Workspace
      title={t("MPDSR Workflows")}
      description={t("Maternal/perinatal death review pipeline: notified → review → corrective actions → closed-loop completion.")}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {stat("Awaiting review", counts.queue, "bg-slate-100 border-slate-300")}
        {stat("Notified", counts.notified, "bg-blue-100 border-blue-300")}
        {stat("In review", counts.in_review, "bg-amber-100 border-amber-300")}
        {stat("Actions assigned", counts.actions, "bg-purple-100 border-purple-300")}
        {stat("Completed", counts.completed, "bg-emerald-100 border-emerald-300")}
        {stat("Overdue", counts.overdue, "bg-red-100 border-red-300")}
      </div>

      {qErr ? <p className="text-sm text-destructive">{t("Could not load queue")}</p> : null}
      {queue?.items?.length > 0 && (
        <Panel title={t("Awaiting review start")}>
          <p className="mb-3 text-xs text-muted-foreground">
            {t("These maternal/perinatal notifications have not been opened for review yet.")}
          </p>
          <div className="space-y-2">
            {queue.items.map((n: any) => (
              <div key={n.notification_id} className="flex items-center justify-between rounded border p-3">
                <div>
                  <p className="text-sm font-medium">
                    {n.patient_name} · {n.facility_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {n.district} · {fmtDate(n.date_of_death)}
                  </p>
                </div>
                <Action
                  onClick={async () => {
                    await post("/mpdsr/workflows", { notificationId: n.notification_id })
                    qMut()
                    mutate()
                    toast.success(t("Review opened"))
                  }}
                >
                  <Play className="mr-1.5 size-4" />
                  {t("Open review")}
                </Action>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title={t("Review pipeline")}>
        <div className="mb-4 flex flex-wrap gap-2">
          {(["all", ...MPDSR_STAGES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s as any)}
              className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                filter === s ? "bg-primary text-primary-foreground" : "bg-background"
              }`}
            >
              {s === "all" ? t("All") : t(stageLabel(s))}
            </button>
          ))}
        </div>
        <LoadState error={error} loading={isLoading} empty={items.length === 0} />
        <div className="space-y-4">
          {items.map((w: any) => (
            <WorkflowCard key={w.workflow_id} item={w} refresh={mutate} />
          ))}
        </div>
      </Panel>
    </Workspace>
  )
}

function WorkflowCard({ item, refresh }: { item: any; refresh: () => unknown }) {
  const { t } = usePreferences()
  const [working, setWorking] = useState(false)
  const [panel, setPanel] = useState(item.review_panel ?? "")
  const [reviewDate, setReviewDate] = useState(
    item.reviewed_at ? new Date(item.reviewed_at).toISOString().split("T")[0] : "",
  )
  const [cause, setCause] = useState(item.cause_classification ?? "")
  const [preventability, setPreventability] = useState(item.preventability ?? "")
  const [factors, setFactors] = useState(
    (item.contributing_factors ? JSON.parse(item.contributing_factors) : []).join("\n"),
  )
  const [notes, setNotes] = useState(item.investigation_notes ?? "")
  const { data: detail } = useSWR<any>(
    item.response_status === "actions_assigned" || item.response_status === "completed"
      ? `/mpdsr/workflows/${item.workflow_id}`
      : null,
    api,
  )
  const [actionText, setActionText] = useState("")
  const [responsible, setResponsible] = useState("")
  const [dueDate, setDueDate] = useState("")
  const actions = detail?.actions ?? []

  const patch = async (body: unknown) => {
    setWorking(true)
    try {
      await api(`/mpdsr/workflows/${item.workflow_id}`, { method: "PATCH", body: JSON.stringify(body) })
      toast.success(t("Review updated"))
      refresh()
    } catch (e: any) {
      toast.error(e?.message ?? "Update failed")
    } finally {
      setWorking(false)
    }
  }

  const addAction = async () => {
    if (!actionText.trim()) return
    setWorking(true)
    try {
      await api(`/mpdsr/workflows/${item.workflow_id}/actions`, {
        method: "POST",
        body: JSON.stringify({ text: actionText.trim(), responsible, dueDate }),
      })
      toast.success(t("Action added"))
      setActionText("")
      setResponsible("")
      setDueDate("")
      refresh()
    } catch (e: any) {
      toast.error(e?.message ?? "Action failed")
    } finally {
      setWorking(false)
    }
  }

  const resolveAction = async (id: string, status: "done" | "cancelled") => {
    await api(`/mpdsr/actions/${id}`, { method: "PATCH", body: JSON.stringify({ status }) })
    toast.success(t("Action updated"))
    refresh()
  }

  const badge = (s: string) => {
    const colors: Record<string, string> = {
      notified: "bg-amber-100 text-amber-800",
      in_review: "bg-blue-100 text-blue-800",
      actions_assigned: "bg-purple-100 text-purple-800",
      completed: "bg-emerald-100 text-emerald-800",
    }
    return <Badge className={colors[s] ?? ""}>{t(stageLabel(s))}</Badge>
  }

  const factorList = (item.contributing_factors ? JSON.parse(item.contributing_factors) : []) as string[]
  const stageBorder: Record<string, string> = {
    notified: "border-l-4 border-amber-500",
    in_review: "border-l-4 border-blue-500",
    actions_assigned: "border-l-4 border-purple-500",
    completed: "border-l-4 border-emerald-500",
  }

  return (
    <Panel title={item.facility_name} className={stageBorder[item.response_status] ?? ""}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Baby className="size-3.5" /> {item.patient_name} · <Clock className="size-3.5" />{" "}
          {fmtDate(item.date_of_death)} · {badge(item.response_status)}
          {item.overdue && <span className="font-bold text-rose-600">· {t("Overdue")}</span>}
          {item.review_due_at && (
            <span>
              · {t("Review due")}: {fmtDate(item.review_due_at)}
            </span>
          )}
        </div>

        {item.response_status === "notified" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t("Start the committee review by recording the panel and review date.")}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs font-medium">{t("Review panel")}</label>
                <Input
                  value={panel}
                  onChange={(e) => setPanel(e.target.value)}
                  placeholder={t("Names, e.g. Dr. X, midwife Y")}
                />
              </div>
              <div>
                <label className="text-xs font-medium">{t("Review date")}</label>
                <Input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} />
              </div>
            </div>
            <Action disabled={working} onClick={() => patch({ stage: "in_review", reviewPanel: panel, reviewDate })}>
              <Play className="mr-1.5 size-4" />
              {t("Start review")}
            </Action>
          </div>
        )}

        {item.response_status === "in_review" && (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-xs font-medium">{t("Cause classification")}</label>
                <Select value={cause} onValueChange={setCause}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("Select cause")} />
                  </SelectTrigger>
                  <SelectContent>
                    {["direct_obstetric", "indirect_obstetric", "coincidental", "undetermined"].map((v) => (
                      <SelectItem key={v} value={v}>
                        {t(v.replace(/_/g, " "))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium">{t("Preventability")}</label>
                <Select value={preventability} onValueChange={setPreventability}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("Select preventability")} />
                  </SelectTrigger>
                  <SelectContent>
                    {["preventable", "potentially_preventable", "not_preventable", "undetermined"].map((v) => (
                      <SelectItem key={v} value={v}>
                        {t(v.replace(/_/g, " "))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium">{t("Contributing factors")}</label>
              <Textarea
                value={factors}
                onChange={(e) => setFactors(e.target.value)}
                placeholder={t("One factor per line")}
              />
            </div>
            <div>
              <label className="text-xs font-medium">{t("Investigation notes")}</label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Action
                disabled={working}
                onClick={() =>
                  patch({
                    stage: "actions_assigned",
                    causeClassification: cause,
                    preventability,
                    contributingFactors: factors
                      .split("\n")
                      .map((s: string) => s.trim())
                      .filter(Boolean),
                    notes,
                  })
                }
              >
                <ListChecks className="mr-1.5 size-4" />
                {t("Record findings → actions")}
              </Action>
              <Action
                disabled={working}
                variant="outline"
                onClick={() =>
                  patch({
                    stage: "completed",
                    causeClassification: cause,
                    preventability,
                    contributingFactors: factors
                      .split("\n")
                      .map((s: string) => s.trim())
                      .filter(Boolean),
                    notes,
                  })
                }
              >
                <FileCheck className="mr-1.5 size-4" />
                {t("Close review now")}
              </Action>
            </div>
          </div>
        )}

        {(item.response_status === "actions_assigned" || item.response_status === "completed") && (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <p className="text-sm">
                <strong>{t("Cause")}:</strong> {item.cause_classification ? t(item.cause_classification.replace(/_/g, " ")) : "-"}
              </p>
              <p className="text-sm">
                <strong>{t("Preventability")}:</strong> {item.preventability ? t(item.preventability.replace(/_/g, " ")) : "-"}
              </p>
            </div>
            <div>
              <strong className="text-sm">{t("Contributing factors")}:</strong>
              <ul className="list-disc pl-5 text-sm">
                {factorList.map((f: string, i: number) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>

            {item.response_status === "actions_assigned" && (
              <>
                <div className="space-y-2 rounded border p-3">
                  <p className="text-xs font-medium uppercase">{t("Add corrective action")}</p>
                  <div className="grid gap-2 md:grid-cols-3">
                    <Input value={actionText} onChange={(e) => setActionText(e.target.value)} placeholder={t("Action")} />
                    <Input value={responsible} onChange={(e) => setResponsible(e.target.value)} placeholder={t("Responsible")} />
                    <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  </div>
                  <Action disabled={working} onClick={addAction}>
                    <Plus className="mr-1.5 size-4" />
                    {t("Add action")}
                  </Action>
                </div>
                <div className="flex justify-end">
                  <Action disabled={working} onClick={() => patch({ stage: "completed" })}>
                    <FileCheck className="mr-1.5 size-4" />
                    {t("Close review")}
                  </Action>
                </div>
              </>
            )}

            {actions.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase">{t("Corrective actions")}</p>
                {actions.map((a: any) => (
                  <div key={a.action_id} className="flex items-center justify-between rounded border p-2 text-sm">
                    <div>
                      <p className={a.status !== "open" ? "text-muted-foreground line-through" : ""}>{a.action_text}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.responsible_party} {a.due_date ? `· ${t("due")} ${fmtDate(a.due_date)}` : ""}
                      </p>
                    </div>
                    {a.status === "open" && item.response_status === "actions_assigned" && (
                      <div className="flex gap-2">
                        <Action variant="outline" onClick={() => resolveAction(a.action_id, "done")}>
                          <CheckCircle2 className="size-3.5" /> {t("Done")}
                        </Action>
                        <Action variant="outline" onClick={() => resolveAction(a.action_id, "cancelled")}>
                          <XCircle className="size-3.5" /> {t("Cancel")}
                        </Action>
                      </div>
                    )}
                    {a.status !== "open" && <Badge variant="secondary">{t(a.status)}</Badge>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  )
}

export function ThresholdPage() {
  const { t } = usePreferences()
  const { data, error, mutate } = useSWR<any>("/alerts/thresholds", api),
    [district, setDistrict] = useState(""),
    [category, setCategory] = useState(""),
    [count, setCount] = useState("8"),
    [hours, setHours] = useState("48")
  return (
    <Workspace title={t("Alert Thresholds")} description={t("Configure district and disease reporting thresholds. Leave a filter blank to match all values.")}>
      <Panel title={t("New detection rule")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("District (optional)")} value={district} onChange={setDistrict} />
          <Field label={t("Disease category (optional)")} value={category} onChange={setCategory} />
          <Field label={t("Minimum reported deaths")} value={count} onChange={setCount} type="number" />
          <Field label={t("Time window (hours)")} value={hours} onChange={setHours} type="number" />
        </div>
        <p className="text-sm text-muted-foreground">
          Trigger at {count} reported deaths within {hours} hours.
        </p>
        <Action
          onClick={async () => {
            await post("/alerts/thresholds", { district: district || null, diseaseCategory: category || null, caseThreshold: Number(count), timeWindowHours: Number(hours) })
            mutate()
            toast.success(t("Threshold saved"))
          }}
        >
          {t("Save rule")}
        </Action>
      </Panel>
      <LoadState error={error} loading={!data && !error} empty={data?.items.length === 0} />
      {data?.items.map((r: any) => (
        <Panel key={r.threshold_id} title={`${r.district || "All districts"} • ${r.disease_category || "All categories"}`}>
          <p className="text-sm">
            {r.case_threshold} deaths / {r.time_window_hours} hours • {r.is_active ? "Active" : "Inactive"}
          </p>
          <div className="flex gap-3">
            <Action
              variant="outline"
              onClick={async () => {
                await api(`/alerts/thresholds/${r.threshold_id}`, { method: "PATCH", body: JSON.stringify({ district: r.district, diseaseCategory: r.disease_category, caseThreshold: r.case_threshold, timeWindowHours: r.time_window_hours, priority: r.alert_priority, active: !r.is_active }) })
                mutate()
              }}
            >
              {r.is_active ? "Deactivate" : "Activate"}
            </Action>
            <Action
              variant="outline"
              onClick={async () => {
                await api(`/alerts/thresholds/${r.threshold_id}`, { method: "DELETE" })
                mutate()
              }}
            >
              {t("Delete rule")}
            </Action>
          </div>
        </Panel>
      ))}
    </Workspace>
  )
}

export function CrossBorderPage() {
  const { t } = usePreferences()
  const { user } = useAuth()
  const analyst = user?.role === "public_health_analyst"
  const { data, error, mutate } = useSWR<any>("/cross-border/cases", api),
    { data: notifs } = useSWR<any>("/notifications", api),
    [id, setId] = useState(""),
    [country, setCountry] = useState(""),
    [crossing, setCrossing] = useState(""),
    [history, setHistory] = useState(""),
    [caseQ, setCaseQ] = useState(""),
    [open, setOpen] = useState(false)
  const selected = notifs?.items.find((n: any) => n.notification_id === id)
  const s = caseQ.trim().toLowerCase()
  const matches = (notifs?.items ?? [])
    .filter((n: any) => !s || `${n.patient_name} ${n.facility_name} ${n.notification_id}`.toLowerCase().includes(s))
    .slice(0, 50)
  return (
    <Workspace
      title={t("Cross-border Tracking")}
      description={
        analyst
          ? t("Flag death notifications where travel into or out of the country was reported, so imported and exported cases stay under HQ surveillance review.")
          : t("Record travel across borders reported for a death notification you filed — flagged cases are escalated for national review.")
      }
    >
      <Panel title={analyst ? t("Flag a case") : t("Record travel history on a case")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">
              {t("Death notification")}
              <span className="ml-0.5 text-destructive">*</span>
            </span>
            <div className="relative">
              <Input
                placeholder={t("Search by patient, facility or notification ID…")}
                value={open ? caseQ : selected ? `${selected.patient_name} — ${selected.facility_name}` : ""}
                onFocus={() => {
                  setOpen(true)
                  setCaseQ("")
                }}
                onChange={(e) => setCaseQ(e.target.value)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
              />
              {open && (
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
                  {matches.length === 0 && (
                    <li className="px-2 py-1.5 text-sm text-muted-foreground">{t("No matching notifications")}</li>
                  )}
                  {matches.map((n: any) => (
                    <li key={n.notification_id}>
                      <button
                        type="button"
                        className="flex w-full flex-col rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                        onMouseDown={() => {
                          setId(n.notification_id)
                          setOpen(false)
                        }}
                      >
                        <span>
                          {n.patient_name} — {n.facility_name}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">{n.notification_id}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </label>
          <Field label={t("Country of origin")} value={country} onChange={setCountry} required />
          <Field label={t("Reported border crossing (if known)")} value={crossing} onChange={setCrossing} />
          <Field label={t("Travel history (as reported)")} value={history} onChange={setHistory} />
        </div>
        <Action
          disabled={!id || country.trim().length < 2}
          onClick={async () => {
            await post("/cross-border/mark", {
              notificationId: id,
              sourceCountry: country.trim(),
              borderCrossingPoint: crossing.trim(),
              travelHistory: history.trim(),
            })
            mutate()
            setId("")
            setCountry("")
            setCrossing("")
            setHistory("")
            toast.success(analyst ? t("Case flagged for cross-border review") : t("Travel history recorded — case escalated for review"))
          }}
        >
          {analyst ? t("Flag case") : t("Save travel record")}
        </Action>
      </Panel>
      <LoadState error={error} loading={!data && !error} empty={data?.items.length === 0} />
      {data?.items.length > 0 && (
        <Rows
          items={data.items}
          columns={[
            ["patient_name", "Case"],
            ["preliminary_icd_code", "ICD"],
            ["source_country", "Origin"],
            ["border_crossing_point", "Crossing"],
            ["district", "District"],
            ["travel_history", "Travel history"],
          ]}
        />
      )}
    </Workspace>
  )
}
