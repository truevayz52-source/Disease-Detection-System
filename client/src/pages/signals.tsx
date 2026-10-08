import { useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { Plus, Radio, RefreshCw, Siren, Timer, TriangleAlert } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { StatCard } from "@/components/stat-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { fmtDateTime } from "@/lib/format"
import { usePreferences } from "@/lib/preferences"

interface Signal {
  signal_id: string
  signal_type: string
  title: string
  description: string | null
  source_channel: string
  district: string | null
  province: string | null
  facility_name: string | null
  severity: string
  status: string
  workflow_stage: string
  reporter_name: string | null
  reported_at: string
  risk_score: number | null
  sla_due_at: string | null
  overdue: number | boolean | null
  sentiment: string | null
  classified_topics: string | null
}

interface Playbook {
  playbook_id: string
  name: string
  description: string | null
  signal_type: string | null
  steps: string
}

const SEVERITY_VARIANT: Record<string, "outline" | "secondary" | "destructive"> = {
  low: "outline", medium: "secondary", high: "destructive", critical: "destructive",
}

export default function SignalRegistryPage() {const{t}=usePreferences();
  const { user } = useAuth()
  const [status, setStatus] = useState("new")
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: "", signalType: "rumour", sourceChannel: "community",
    district: "", province: "", severity: "medium", description: "",
  })
  const { data, mutate } = useSWR<{ items: Signal[] }>(`/signals?status=${status}`, (u: string) => api(u))
  const { data: playbooks } = useSWR<{ items: Playbook[] }>("/playbooks", (u: string) => api(u))
  const canTriage = user && ["public_health_analyst", "system_admin"].includes(user.role)

  function riskVariant(score: number | null): "outline" | "secondary" | "destructive" {
    if (score == null) return "outline"
    if (score >= 60) return "destructive"
    if (score >= 40) return "secondary"
    return "outline"
  }

  async function attachPlaybook(signalId: string, playbookId: string) {
    try {
      await api(`/signals/${signalId}/playbook`, { method: "POST", body: JSON.stringify({ playbookId }) })
      toast.success(t("Playbook attached."))
      mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Attach failed")
    }
  }

  async function uploadEvidence(signalId: string, file: File) {
    try {
      const fd = new FormData()
      fd.append("entityType", "signal")
      fd.append("entityId", signalId)
      fd.append("file", file)
      await api("/evidence", { method: "POST", body: fd })
      toast.success(t("Evidence uploaded."))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    }
  }

  async function createSignal() {
    setSaving(true)
    try {
      await api("/signals", {
        method: "POST",
        body: JSON.stringify({
          title: form.title, signalType: form.signalType, sourceChannel: form.sourceChannel,
          district: form.district || undefined, province: form.province || undefined,
          severity: form.severity, description: form.description || undefined,
        }),
      })
      toast.success(t("Signal captured."))
      setOpen(false)
      setForm({ title: "", signalType: "rumour", sourceChannel: "community", district: "", province: "", severity: "medium", description: "" })
      mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to capture signal")
    } finally {
      setSaving(false)
    }
  }

  async function transition(id: string, stage: string, nextStatus?: string) {
    try {
      await api(`/signals/${id}/workflow`, { method: "PATCH", body: JSON.stringify({ stage, status: nextStatus }) })
      toast.success(`Signal ${stage}.`)
      mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Transition failed")
    }
  }

  return (
    <>
      <SiteHeader title={t("Signal Registry")} />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label={`${status[0].toUpperCase() + status.slice(1)} signals`} value={data?.items.length} icon={Radio} color="blue" compact />
          <StatCard label={t("High risk (≥60)")} value={(data?.items ?? []).filter((s) => (s.risk_score ?? 0) >= 60).length} icon={Siren} color="red" compact />
          <StatCard label={t("Overdue SLA")} value={(data?.items ?? []).filter((s) => !!s.overdue).length} icon={Timer} color="amber" compact />
          <StatCard label={t("Critical severity")} value={(data?.items ?? []).filter((s) => s.severity === "critical").length} icon={TriangleAlert} color="purple" compact />
        </div>
        <div className="flex items-center gap-3">
          <Select value={status} onValueChange={(v) => setStatus(v ?? "new")}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="new">{t("New")}</SelectItem>
              <SelectItem value="triaged">{t("Triaged")}</SelectItem>
              <SelectItem value="investigating">{t("Investigating")}</SelectItem>
              <SelectItem value="resolved">{t("Resolved")}</SelectItem>
              <SelectItem value="dismissed">{t("Dismissed")}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => mutate()}><RefreshCw className="size-3.5" /> {t("Refresh")}</Button>
          <p className="text-sm text-muted-foreground">{data?.items.length ?? 0} signal(s)</p>
          <div className="ml-auto">
            <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4" /> {t("New signal")}</Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {(data?.items ?? []).map((s) => (
            <Card key={s.signal_id} className="shadow-lg">
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{s.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {s.signal_type.replace(/_/g, " ")} · {s.source_channel}
                      {s.district ? ` · ${s.district}` : ""}{s.province ? `, ${s.province}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.risk_score != null && <Badge variant={riskVariant(s.risk_score)}>Risk {s.risk_score}</Badge>}
                    {Boolean(s.overdue) && <Badge variant="destructive">{t("Overdue")}</Badge>}
                    <Badge variant={SEVERITY_VARIANT[s.severity] ?? "outline"}>{s.severity}</Badge>
                    <Badge variant="outline">{s.workflow_stage}</Badge>
                  </div>
                </div>
                {s.description && <p className="text-sm text-muted-foreground line-clamp-3">{s.description}</p>}
                {(s.classified_topics || s.sentiment) && (
                  <p className="text-[11px] text-muted-foreground">
                    {s.classified_topics ? `Topics: ${s.classified_topics.replace(/,/g, ", ")}` : ""}
                    {s.sentiment ? ` · Sentiment: ${s.sentiment}` : ""}
                    {s.sla_due_at ? ` · Response due ${fmtDateTime(s.sla_due_at)}` : ""}
                  </p>
                )}
                <div className="text-xs text-muted-foreground">
                  Reported {fmtDateTime(s.reported_at)}{s.reporter_name ? ` by ${s.reporter_name}` : ""}
                  {s.facility_name ? ` · ${s.facility_name}` : ""}
                </div>
                {canTriage && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {s.workflow_stage === "captured" && (
                      <Button size="sm" variant="outline" onClick={() => transition(s.signal_id, "verified", "triaged")}>{t("Verify")}</Button>
                    )}
                    {s.workflow_stage === "verified" && (
                      <Button size="sm" variant="outline" onClick={() => transition(s.signal_id, "escalated", "investigating")}>{t("Escalate")}</Button>
                    )}
                    {s.workflow_stage === "escalated" && (
                      <Button size="sm" variant="outline" onClick={() => transition(s.signal_id, "closed", "resolved")}>{t("Close as resolved")}</Button>
                    )}
                    {s.status !== "dismissed" && s.status !== "resolved" && (
                      <Button size="sm" variant="ghost" onClick={() => transition(s.signal_id, "closed", "dismissed")}>{t("Dismiss")}</Button>
                    )}
                    {(playbooks?.items?.length ?? 0) > 0 && (
                      <Select onValueChange={(v) => { const id = v as string; if (id) attachPlaybook(s.signal_id, id) }}>
                        <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder={t("Attach playbook")} /></SelectTrigger>
                        <SelectContent>
                          {(playbooks?.items ?? []).map((pb) => (
                            <SelectItem key={pb.playbook_id} value={pb.playbook_id}>{pb.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-muted-foreground cursor-pointer hover:text-foreground">
                    <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadEvidence(s.signal_id, f); e.target.value = "" }} />
                    + Attach evidence file
                  </label>
                </div>
              </CardContent>
            </Card>
          ))}
          {!data?.items?.length && (
            <Card className="shadow-lg"><CardContent className="py-10 text-center text-sm text-muted-foreground">No {status} signals.</CardContent></Card>
          )}
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("Capture signal")}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>{t("Title")}</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("Signal type")}</Label>
                <Select value={form.signalType} onValueChange={(v) => setForm({ ...form, signalType: v ?? "rumour" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="rumour">{t("Rumour")}</SelectItem>
                    <SelectItem value="outbreak_report">{t("Outbreak report")}</SelectItem>
                    <SelectItem value="misinformation">{t("Misinformation")}</SelectItem>
                    <SelectItem value="community_alert">{t("Community alert")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("Source channel")}</Label>
                <Select value={form.sourceChannel} onValueChange={(v) => setForm({ ...form, sourceChannel: v ?? "community" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="community">{t("Community")}</SelectItem>
                    <SelectItem value="vhw">{t("Village Health Worker")}</SelectItem>
                    <SelectItem value="facility">{t("Facility")}</SelectItem>
                    <SelectItem value="media">{t("Media")}</SelectItem>
                    <SelectItem value="offline">{t("Offline capture")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>{t("Province")}</Label>
                <Input value={form.province} onChange={(e) => setForm({ ...form, province: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{t("District")}</Label>
                <Input value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{t("Severity")}</Label>
                <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v ?? "medium" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">{t("Low")}</SelectItem>
                    <SelectItem value="medium">{t("Medium")}</SelectItem>
                    <SelectItem value="high">{t("High")}</SelectItem>
                    <SelectItem value="critical">{t("Critical")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("Description")}</Label>
              <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("Cancel")}</Button>
            <Button disabled={saving || form.title.trim().length < 2} onClick={createSignal}>{t("Capture")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
