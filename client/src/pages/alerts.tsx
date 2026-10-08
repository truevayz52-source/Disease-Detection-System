import { useMemo, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw, Search, Siren, SlidersHorizontal, Sparkles, Users } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { StatCard } from "@/components/stat-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { aiExplainAlert } from "@/lib/ai"
import { fmtDateTime, riskVariant, STATUS_LABELS } from "@/lib/format"
import type { OutbreakAlert } from "@/lib/types"
import { usePreferences } from "@/lib/preferences"

function parseCluster(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// Plain-language AI explanation for one alert card — aggregates only.
function AlertExplain({ alert }: { alert: OutbreakAlert }) {
  const { language, t } = usePreferences()
  const [text, setText] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const cluster = parseCluster(alert.cluster_data)

  async function explain() {
    setPending(true)
    try {
      setText(await aiExplainAlert({
        alertType: alert.alert_type,
        disease: alert.disease_category ?? "",
        district: alert.district ?? "",
        caseCount: alert.case_count ?? 0,
        severity: `${alert.risk_score ?? 0}/100`,
        triggeredAt: alert.triggered_date,
        windowDays: typeof cluster?.window_hours === "number" ? Math.round(cluster.window_hours / 24) : 0,
      }, language))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("AI explanation failed"))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" size="sm" variant="outline" onClick={explain} disabled={pending}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
        {pending ? t("Explaining…") : t("Explain with AI")}
      </Button>
      {text && (
        <div className="rounded-md border border-dashed bg-muted/30 p-3">
          <p className="whitespace-pre-wrap text-sm">{text}</p>
          <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Sparkles className="size-3" />
            {t("AI-generated draft — verify against surveillance data")}
          </p>
        </div>
      )}
    </div>
  )
}

export default function AlertsPage() {const{t}=usePreferences();
  const { user } = useAuth()
  const [status, setStatus] = useState("active")
  const [type, setType] = useState("all")
  const [province, setProvince] = useState("all")
  const [district, setDistrict] = useState("all")
  const [minRisk, setMinRisk] = useState("0")
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<"recent" | "risk" | "cases">("recent")

  const { data, mutate, isValidating } = useSWR<{ items: OutbreakAlert[] }>(
    `/alerts?${status !== "all" ? `status=${status}&` : ""}${type !== "all" ? `type=${type}` : ""}`,
    (u: string) => api(u),
    { refreshInterval: 30_000 },
  )
  const canResolve = user && ["public_health_analyst", "system_admin"].includes(user.role)
  const { data: geo } = useSWR<{ provinces: { province_id: string; province_name: string }[]; districts: { district_id: string; province: string; district: string }[] }>("/facilities/geo", (u: string) => api(u))
  const { data: stats } = useSWR<{ active: number; resolved: number; critical: number; highRisk: number; activeCases: number; total: number }>(
    "/alerts/stats",
    (u: string) => api(u),
    { refreshInterval: 30_000 },
  )

  const districts = useMemo(
    () => (geo?.districts ?? []).filter((d) => d.province === province).map((d) => d.district).sort(),
    [geo, province],
  )

  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    const provDistricts = province !== "all"
      ? new Set((geo?.districts ?? []).filter((d) => d.province === province).map((d) => d.district))
      : null
    const list = (data?.items ?? []).filter((a) => {
      if (provDistricts && !provDistricts.has(a.district ?? "")) return false
      if (district !== "all" && a.district !== district) return false
      if ((a.risk_score ?? 0) < Number(minRisk)) return false
      if (!q) return true
      return [a.disease_category, a.district, a.alert_type].some((v) => v?.toLowerCase().includes(q))
    })
    return [...list].sort((a, b) =>
      sort === "risk" ? (b.risk_score ?? 0) - (a.risk_score ?? 0)
      : sort === "cases" ? (b.case_count ?? 0) - (a.case_count ?? 0)
      : new Date(b.triggered_date).getTime() - new Date(a.triggered_date).getTime(),
    )
  }, [data, search, district, province, geo, minRisk, sort])

  const statCards = [
    {
      label: t("Active alerts"),
      value: stats?.active ?? 0,
      icon: Siren,
      color: "blue" as const,
      sub: `${stats?.resolved ?? 0} ${t("resolved")} · ${stats?.total ?? 0} ${t("total")}`,
    },
    {
      label: t("Critical (risk ≥75)"),
      value: stats?.critical ?? 0,
      icon: AlertTriangle,
      color: "red" as const,
      sub: t("active now"),
      pulse: (stats?.critical ?? 0) > 0,
    },
    {
      label: t("High risk (50–74)"),
      value: stats?.highRisk ?? 0,
      icon: Activity,
      color: "amber" as const,
      sub: t("active now"),
    },
    {
      label: t("Cases in active alerts"),
      value: stats?.activeCases ?? 0,
      icon: Users,
      color: "emerald" as const,
      sub: t("across all districts"),
    },
  ]

  async function resolve(id: string) {
    try {
      await api(`/alerts/${id}/resolve`, { method: "PATCH" })
      toast.success(t("Alert resolved."))
      mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Resolve failed")
    }
  }

  return (
    <>
      <SiteHeader title={t("Alerts")} />
      <div className="space-y-4 p-4 lg:p-6">
        {/* Summary strip */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {statCards.map((c) => (
            <StatCard key={c.label} {...c} compact />
          ))}
        </div>

        {/* Filter toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search disease, district…")} className="pl-8" />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v ?? "active")}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">{t("Active")}</SelectItem>
              <SelectItem value="resolved">{t("Resolved")}</SelectItem>
              <SelectItem value="all">{t("All")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={type} onValueChange={(v) => setType(v ?? "all")}>
            <SelectTrigger className="w-36"><SelectValue placeholder={t("All types")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All types")}</SelectItem>
              <SelectItem value="outbreak">{t("Outbreak")}</SelectItem>
              <SelectItem value="mpdsr">{t("MPDSR")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={province} onValueChange={(v) => { setProvince(v ?? "all"); setDistrict("all") }}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All provinces")}</SelectItem>
              {(geo?.provinces ?? []).map((p) => (
                <SelectItem key={p.province_id} value={p.province_name}>{p.province_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {province !== "all" && (
            <Select value={district} onValueChange={(v) => setDistrict(v ?? "all")}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("Whole province")}</SelectItem>
                {districts.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={minRisk} onValueChange={(v) => setMinRisk(v ?? "0")}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t("Any risk")}</SelectItem>
              <SelectItem value="50">{t("Risk ≥ 50")}</SelectItem>
              <SelectItem value="75">{t("Risk ≥ 75")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort((v ?? "recent") as typeof sort)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">{t("Newest first")}</SelectItem>
              <SelectItem value="risk">{t("Highest risk")}</SelectItem>
              <SelectItem value="cases">{t("Most cases")}</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" onClick={() => mutate()} title={t("Refresh")}>
            <RefreshCw className={`size-4 ${isValidating ? "animate-spin" : ""}`} />
          </Button>
          <p className="ml-auto text-sm text-muted-foreground">{t("{n} alert(s)", { n: items.length })}</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((a) => {
            const cluster = parseCluster(a.cluster_data)
            const risk = a.risk_score ?? 0
            const critical = a.status === "active" && risk >= 75
            const accent = a.status === "resolved"
              ? "border-emerald-500/40"
              : critical
                ? "border-red-600/50 ring-1 ring-red-600/20"
                : risk >= 50
                  ? "border-amber-500/50"
                  : "border-border"
            const bar = risk >= 75 ? "bg-red-600" : risk >= 50 ? "bg-amber-500" : "bg-blue-500"
            const Icon = a.status === "resolved" ? CheckCircle2 : a.alert_type === "mpdsr" ? Users : critical ? Siren : AlertTriangle
            return (
              <Card key={a.alert_id} className={`overflow-hidden transition-shadow hover:shadow-md ${accent}`}>
                {/* accent strip */}
                <div className={`h-1 w-full ${a.status === "resolved" ? "bg-emerald-500" : bar}`} />
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 rounded-lg p-2 ${a.status === "resolved" ? "bg-emerald-500/10 text-emerald-600" : critical ? "bg-red-600/10 text-red-600" : "bg-muted text-muted-foreground"}`}>
                        <Icon className="size-4" />
                      </div>
                      <div>
                        <p className="font-semibold leading-tight">{a.disease_category}</p>
                        <p className="text-sm text-muted-foreground">
                          {a.district} · {t("{n} case(s)", { n: a.case_count })}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Badge variant={a.alert_type === "mpdsr" ? "secondary" : riskVariant(risk)}>
                        {a.alert_type === "mpdsr" ? "MPDSR" : `Risk ${risk}`}
                      </Badge>
                      <Badge variant={a.status === "active" ? "destructive" : "outline"}>{t(STATUS_LABELS[a.status] ?? a.status)}</Badge>
                    </div>
                  </div>

                  {/* risk meter */}
                  {a.alert_type !== "mpdsr" && (
                    <div>
                      <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                        <span>{t("Risk score")}</span><span className="font-semibold tabular-nums">{risk}/100</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${Math.min(100, risk)}%` }} />
                      </div>
                    </div>
                  )}

                  {/* metadata grid */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-muted/40 p-2.5 text-[11px] text-muted-foreground sm:grid-cols-3">
                    <span>{t("Triggered:")} {fmtDateTime(a.triggered_date)}</span>
                    {cluster?.window_hours ? <span>{t("Window:")} {String(cluster.window_hours)}h</span> : null}
                    {cluster?.detection ? <span>{t("Detection:")} {String(cluster.detection)}</span> : null}
                    <span className="col-span-full">{t("Channels:")} {a.dispatched_channels ?? "dashboard"}</span>
                    {a.resolved_at && <span className="text-emerald-600">{t("Resolved:")} {fmtDateTime(a.resolved_at)}</span>}
                  </div>

                  <AlertExplain alert={a} />

                  {canResolve && a.status === "active" && (
                    <div className="flex justify-end pt-1">
                      <Button size="sm" variant={critical ? "destructive" : "outline"} onClick={() => resolve(a.alert_id)}>
                        <CheckCircle2 className="size-4" /> {t("Resolve alert")}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
          {!items.length && (
            <Card className="shadow-lg">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                <SlidersHorizontal className="mx-auto mb-2 size-5 text-muted-foreground/60" />
                {t("No alerts match the current filters.")}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  )
}
