import { useMemo, useState } from "react"
import useSWR from "swr"
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
  const { data: clusters, mutate } = useSWR<ClusterRes>("/analytics/clusters", (u: string) => api(u))
  const { data: engine } = useSWR<{ python: boolean }>("/analytics/engine-status", (u: string) => api(u))
  const [detecting, setDetecting] = useState(false)

  const categories = useMemo(
    () => [...new Set((trends?.rows ?? []).map((r) => r.category))].sort(),
    [trends],
  )
  const chartData = useMemo(() => {
    const byWeek = new Map<string, Record<string, number | string>>()
    for (const r of trends?.rows ?? []) {
      if (!byWeek.has(r.week_start)) byWeek.set(r.week_start, { week: r.week_start })
      byWeek.get(r.week_start)![r.category] = Number(r.count)
    }
    return [...byWeek.values()].sort((a, b) => String(a.week).localeCompare(String(b.week)))
  }, [trends])

  const forecastData = useMemo(
    () => [
      ...(trends?.series ?? []).map((s) => ({ week: s.week, actual: s.count, predicted: null as number | null })),
      ...(trends?.forecast ?? []).map((f) => ({ week: f.week, actual: null as number | null, predicted: f.predicted })),
    ],
    [trends],
  )

  const provinceCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of clusters?.clusters ?? []) {
      const prov = c.province ?? c.district
      if (prov) m.set(prov, (m.get(prov) ?? 0) + c.count)
    }
    return [...m.entries()].map(([province, count]) => ({ province, count })).sort((a, b) => b.count - a.count)
  }, [clusters])

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
            Analytics engine:{" "}
            <Badge variant={engine?.python ? "default" : "secondary"}>
              {engine?.python ? "Python scikit-learn" : "Node fallback"}
            </Badge>
          </p>
          <Button variant="outline" size="sm" className="ml-auto" disabled={detecting} onClick={detectNow}>
            {detecting ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />}
            Run outbreak detection
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-sm">{t("Weekly mortality by disease category")}</CardTitle>
              <CardDescription>{t("Last 12 weeks")}</CardDescription>
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
              <CardTitle className="text-sm">{t("Mortality trend & forecast")}</CardTitle>
              <CardDescription>{t("Actual vs 4-week projection")}</CardDescription>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={forecastData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="actual" name="Actual deaths" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} style={{ filter: "drop-shadow(0 3px 4px rgba(37,99,235,0.35))" }} />
                  <Line type="monotone" dataKey="predicted" name="Forecast" stroke="#dc2626" strokeWidth={2.5} strokeDasharray="5 5" dot={{ r: 3 }} style={{ filter: "drop-shadow(0 3px 4px rgba(220,38,38,0.35))" }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-sm">{t("Spatial clusters")}</CardTitle>
              <CardDescription>
                {clusters?.engine === "python-sklearn" ? "DBSCAN clusters (scikit-learn)" : "District × category groups (Node fallback)"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Province</TableHead>
                    <TableHead className="text-right">Cases</TableHead>
                    <TableHead>Centroid</TableHead>
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
                        <TableCell>{c.province ?? c.district ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.count}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {c.centroid_lat.toFixed(3)}, {c.centroid_lng.toFixed(3)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-sm">{t("Deaths by province")}</CardTitle>
              <CardDescription>{t("Detected case distribution")}</CardDescription>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={provinceCounts} layout="vertical">
                  <DepthDefs id="dist" colors={["#2563eb"]} />
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="province" width={110} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill={grad("dist", 0, true)} name="Cases" radius={[0, 5, 5, 0]} style={{ filter: shadow("dist") }} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
