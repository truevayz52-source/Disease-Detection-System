import { useMemo, useState } from "react"
import useSWR from "swr"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import {
  ChevronDown,
  GitCompare,
  Info,
  Layers,
  Loader2,
  Radar,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { SiteHeader } from "@/components/site-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api"
import { DepthDefs, grad, shadow } from "@/components/chart-3d"
import { usePreferences } from "@/lib/preferences"

interface TrendRow {
  week_start: string
  category: string
  count: number
}
interface Trends {
  rows: TrendRow[]
  series: { week: string; count: number }[]
  forecast: { week: string; predicted: number }[]
}
interface Cluster {
  category: string
  district?: string
  province?: string
  count: number
  centroid_lat: number
  centroid_lng: number
  ids: string[]
  source: string
}
interface ClusterRes {
  engine: string
  clusters: Cluster[]
}

const PALETTE = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#be185d", "#65a30d"]

export default function AnalyticsPage() {const{t}=usePreferences();
  const { data: trends } = useSWR<Trends>("/analytics/trends?weeks=12", (u: string) => api(u))
  // Refresh spatial clusters every 8 minutes so users see automatic outbreak detection results.
  const { data: clusters, mutate } = useSWR<ClusterRes>(
    "/analytics/clusters",
    (u: string) => api(u),
    { refreshInterval: 8 * 60 * 1000 },
  )
  const { data: engine } = useSWR<{ python: boolean }>("/analytics/engine-status", (u: string) => api(u))
  const { data: dash } = useSWR<{ byProvince: { province: string; count: number }[] }>("/analytics/dashboard", (u: string) => api(u))
  const [detecting, setDetecting] = useState(false)

  const categories = useMemo(
    () => [...new Set((trends?.rows ?? []).map((r) => r.category))].sort(),
    [trends],
  )
  // Continuous Monday-start week axis covering the 12-week window,
  // matching Postgres date_trunc('week'). Both charts zero-fill onto this
  // axis — a category/week with deaths in only one bucket otherwise
  // renders as a disconnected sliver or a gap.
  const weekAxis = useMemo(() => {
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const monday = new Date()
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    const weeks = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(d.getDate() - (11 - i) * 7)
      return fmt(d)
    })
    for (const r of trends?.rows ?? []) if (!weeks.includes(r.week_start)) weeks.push(r.week_start)
    for (const s of trends?.series ?? []) if (!weeks.includes(s.week)) weeks.push(s.week)
    return weeks.sort()
  }, [trends])

  const chartData = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of trends?.rows ?? []) counts.set(`${r.week_start}|${r.category}`, Number(r.count))
    return weekAxis.map((week) => {
      const row: Record<string, number | string> = { week }
      for (const c of categories) row[c] = counts.get(`${week}|${c}`) ?? 0
      return row
    })
  }, [trends, categories, weekAxis])

  const forecastData = useMemo(() => {
    const actual = new Map((trends?.series ?? []).map((s) => [s.week, s.count]))
    return [
      ...weekAxis.map((week) => ({ week, actual: actual.get(week) ?? 0, predicted: null as number | null })),
      ...(trends?.forecast ?? []).map((f) => ({ week: f.week, actual: null as number | null, predicted: f.predicted })),
    ]
  }, [trends, weekAxis])

  // Deaths by province comes from the dashboard aggregation (all reported
  // deaths in 90 days) — the clusters feed only yields rows when an outbreak
  // cluster exists, which left this chart blank on a quiet dataset.
  const provinceCounts = useMemo(
    () => (dash?.byProvince ?? []).slice().sort((a, b) => b.count - a.count),
    [dash],
  )

  const [showPipeline, setShowPipeline] = useState(false)

  // Compute pattern analytics summaries for Objective 3
  const patternSummary = useMemo(() => {
    const categoryTotals = new Map<string, number>()
    let totalAll = 0
    for (const r of trends?.rows ?? []) {
      const c = Number(r.count) || 0
      totalAll += c
      categoryTotals.set(r.category, (categoryTotals.get(r.category) ?? 0) + c)
    }

    let topCategory = "Notifiable Conditions"
    let topCount = 0
    for (const [cat, count] of categoryTotals.entries()) {
      if (count > topCount) {
        topCount = count
        topCategory = cat
      }
    }
    const topPct = totalAll > 0 ? Math.round((topCount / totalAll) * 100) : 0
    const topProvince = provinceCounts[0]?.province ?? "National"

    return { totalAll, topCategory, topCount, topPct, topProvince }
  }, [trends, provinceCounts])

  async function detectNow() {
    setDetecting(true)
    try {
      const r = await api<{ created: unknown[] }>("/analytics/detect", { method: "POST" })
      toast.success(r.created.length ? `${r.created.length} new alert(s) created.` : "No new clusters detected.")
      mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Detection failed")
    } finally {
      setDetecting(false)
    }
  }

  return (
    <>
      <SiteHeader title={t("Outbreak Analytics")} />
      <div className="space-y-6 p-4 lg:p-6">
        {/* Objective 3 Self-Explaining Architecture Card */}
        <div className="rounded-2xl border border-purple-200/90 bg-gradient-to-r from-purple-50/80 via-card to-card p-5 shadow-md">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge className="bg-purple-600 text-white font-semibold text-xs px-2.5 py-0.5">
                  {t("System Objective 3")}
                </Badge>
                <span className="font-bold text-foreground text-sm tracking-tight">
                  {t("To Identify Cause-of-Death Patterns")}
                </span>
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-purple-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-purple-600" />
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
                {t("Correlates demographic factors, spatial coordinates, and clinical autopsy findings to expose leading causes of mortality and geographical disease hotspots.")}
              </p>
            </div>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowPipeline(!showPipeline)}
              className="h-8 text-xs font-semibold bg-white hover:bg-purple-50 text-purple-700 border-purple-200 gap-1.5 shadow-2xs"
            >
              <Layers className="size-3.5 text-purple-600" />
              {showPipeline ? t("Hide ICD Pipeline") : t("Explain ICD-10 Verification")}
              <ChevronDown className={`size-3.5 transition-transform duration-200 ${showPipeline ? "rotate-180" : ""}`} />
            </Button>
          </div>

          {/* Automated Cause-of-Death Pattern Synthesis Box */}
          <div className="mt-3.5 rounded-xl border border-purple-200/80 bg-white/80 p-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <Sparkles className="size-3.5 text-purple-600" />
              <span className="text-xs font-bold text-purple-950 uppercase tracking-wide">
                {t("Autonomous Pattern Synthesis")}
              </span>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              {patternSummary.totalAll > 0 ? (
                <>
                  {t("Across the monitored 12-week surveillance window,")} <strong className="text-purple-900">{patternSummary.topCategory}</strong> {t("represents the leading cause of mortality, accounting for")} <strong className="text-purple-900">{patternSummary.topPct}% ({patternSummary.topCount} cases)</strong> {t("of all notified deaths.")}{" "}
                  {t("Geographic concentration is highest in")} <strong className="text-purple-900">{patternSummary.topProvince}</strong>.{" "}
                  {t("DBSCAN spatial clustering is actively monitoring localized coordinates to detect micro-outbreak centroids.")}
                </>
              ) : (
                t("Surveillance engine active. Awaiting certified death notifications to compute demographic and geographical cause-of-death cluster matrices.")
              )}
            </p>
          </div>

          {showPipeline && (
            <div className="mt-4 pt-4 border-t border-purple-200/80 space-y-3 text-xs animate-in fade-in-50 duration-200">
              <span className="font-bold text-purple-950 flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-emerald-600" />
                {t("Closed-Loop Data Quality & Pathologist Verification Pipeline")}
              </span>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-purple-200 bg-white p-3 space-y-1">
                  <span className="font-semibold text-foreground text-[11px] block text-purple-900">
                    {t("1. Preliminary Capture")}
                  </span>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {t("Facility officers assign an initial ICD-10 code at time of death notification to ensure immediate surveillance visibility.")}
                  </p>
                </div>
                <div className="rounded-xl border border-purple-200 bg-purple-50/70 p-3 space-y-1">
                  <span className="font-semibold text-foreground text-[11px] block text-purple-900">
                    {t("2. Pathologist Autopsy")}
                  </span>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {t("Pathologists or certifying officers conduct physical or verbal autopsy reviews, documenting definitive clinical findings.")}
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 space-y-1">
                  <span className="font-semibold text-foreground text-[11px] block text-emerald-900">
                    {t("3. Golden Truth Re-classification")}
                  </span>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {t("Once finalized, verified autopsy ICD-10 codes replace preliminary codes across all analytics, cluster maps, and predictions.")}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {t("The system automatically checks for unusual groupings of deaths.")}{" "}
            <Badge variant={engine?.python ? "default" : "secondary"} className="ml-1">
              {engine?.python ? t("Full detection engine") : t("Basic detection")}
            </Badge>
          </p>
          <Button variant="outline" size="sm" className="ml-auto" disabled={detecting} onClick={detectNow}>
            {detecting ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />}
            {t("Check now")}
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-sm">{t("Deaths per week, by cause")}</CardTitle>
              <CardDescription>{t("How many deaths were reported each week — coloured by cause of death")}</CardDescription>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <DepthDefs id="wk" colors={PALETTE} />
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  {categories.map((c, i) => (
                    <Area key={c} type="monotone" dataKey={c} stackId="1" stroke={PALETTE[i % PALETTE.length]} fill={grad("wk", i % PALETTE.length)} fillOpacity={0.6} style={{ filter: shadow("wk") }} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-sm">{t("Reported deaths and what's expected")}</CardTitle>
              <CardDescription>{t("Solid line = deaths reported · Dashed line = what the system expects")}</CardDescription>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={forecastData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="actual" name={t("Reported deaths")} stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} style={{ filter: "drop-shadow(0 3px 4px rgba(37,99,235,0.35))" }} />
                  <Line type="monotone" dataKey="predicted" name={t("Expected")} stroke="#dc2626" strokeWidth={2.5} strokeDasharray="5 5" dot={{ r: 3 }} style={{ filter: "drop-shadow(0 3px 4px rgba(220,38,38,0.35))" }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-sm">{t("Where deaths are grouping")}</CardTitle>
              <CardDescription>{t("Places with an unusual number of deaths from the same cause")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Cause of death")}</TableHead>
                    <TableHead>{t("Where")}</TableHead>
                    <TableHead className="text-right">{t("Deaths")}</TableHead>
                    <TableHead className="text-right">{t("Action")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(clusters?.clusters ?? [])
                    .slice()
                    .sort((a, b) => b.count - a.count)
                    .slice(0, 12)
                    .map((c, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium">{c.category}</TableCell>
                        <TableCell>{c.district ?? c.province ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.count}</TableCell>
                        <TableCell className="text-right">
                          <Link
                            to={`/notifications?district=${encodeURIComponent(c.district ?? c.province ?? "")}&category=${encodeURIComponent(c.category)}`}
                            className="text-xs font-medium text-blue-600 hover:underline"
                          >
                            {t("Investigate")}
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  {(clusters?.clusters ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground">
                        {t("No unusual groupings detected right now.")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-sm">{t("Deaths by province")}</CardTitle>
              <CardDescription>{t("Which provinces the reported deaths are coming from")}</CardDescription>
            </CardHeader>
            <CardContent className="h-72">
              {provinceCounts.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={provinceCounts} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                    <DepthDefs id="prov" colors={["#2563eb"]} />
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="province" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={56} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
                    <Tooltip />
                    <Bar dataKey="count" name={t("Deaths")} fill={grad("prov", 0)} radius={[5, 5, 0, 0]} style={{ filter: shadow("prov") }} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {t("No reported deaths to chart yet.")}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
