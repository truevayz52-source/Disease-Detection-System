import { useMemo, useState } from "react"
import useSWR from "swr"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { Loader2, Radar } from "lucide-react"
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
