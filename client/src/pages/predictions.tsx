import useSWR from "swr"
import { Minus, TrendingDown, TrendingUp } from "lucide-react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { SiteHeader } from "@/components/site-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api"
import { usePreferences } from "@/lib/preferences"

interface Point { label: string; count: number }
interface ForecastPoint { label: string; predicted: number }
interface CategoryProjection {
  category: string
  trend: "rising" | "falling" | "stable" | "insufficient_data"
  series: Point[]
  forecast: ForecastPoint[]
  horizonTotal: number
  summary: string[]
}
interface Predictions {
  granularity: "weekly" | "daily"
  periodWord: string
  overall: { series: Point[]; forecast: ForecastPoint[]; directionPct: number; forecastMethod: "regression" | "rate-baseline" | null; summary: string[] }
  byCategory: CategoryProjection[]
  byDistrict: { district: string; projected: number; sharePct: number }[]
  topSummary: string[]
  banner: { state: "stable" | "watch" | "alert"; headline: string; detail: string }
  activeAlertCount: number
  metrics: {
    projectedTotal: number
    projectedLower: number
    projectedUpper: number
    projectedPeriod: string
    projectedMethod: "seasonal" | "regression" | "rate-baseline" | null
    activeAlerts: number
    topCategory: string | null
    topCategoryProjected: number
  }
  objectives: { key: "prediction" | "detection" | "patterns"; status: string; detail: string }[]
}

function SummaryLines({ lines }: { lines: string[] }) {
  return (
    <ul className="space-y-1 border-t pt-3 text-sm text-muted-foreground">
      {lines.map((line, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden>•</span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  )
}

function ProjectionChart({ series, forecast, nowMarker }: { series: Point[]; forecast: ForecastPoint[]; nowMarker?: boolean }) {
  const data = [
    ...series.map((s) => ({ label: s.label, actual: s.count, predicted: null as number | null })),
    // Bridge point so the dashed line starts where the actuals end.
    ...(forecast.length && series.length
      ? [{ label: series[series.length - 1].label, actual: null as number | null, predicted: series[series.length - 1].count }]
      : []),
    ...forecast.map((f) => ({ label: f.label, actual: null as number | null, predicted: f.predicted })),
  ]
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        {nowMarker && series.length ? (
          <ReferenceLine x={series[series.length - 1].label} stroke="#64748b" strokeDasharray="2 2" label={{ value: "now", position: "top", fontSize: 10, fill: "#64748b" }} />
        ) : null}
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="actual" name="Actual deaths" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="predicted" name="Forecast" stroke="#dc2626" strokeWidth={2.5} strokeDasharray="5 5" dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function TrendChip({ trend }: { trend: CategoryProjection["trend"] }) {
  const { t } = usePreferences()
  if (trend === "insufficient_data") return <Badge variant="outline">{t("Not enough data")}</Badge>
  if (trend === "rising") return <Badge variant="destructive"><TrendingUp className="size-3" /> {t("Rising")}</Badge>
  if (trend === "falling") return <Badge variant="secondary"><TrendingDown className="size-3" /> {t("Declining")}</Badge>
  return <Badge variant="secondary"><Minus className="size-3" /> {t("Stable")}</Badge>
}

const BANNER_STYLE = {
  stable: { ring: "border-emerald-500/50 bg-emerald-500/5", chip: "bg-emerald-600 text-white", label: "STABLE" },
  watch: { ring: "border-amber-500/60 bg-amber-500/5", chip: "bg-amber-500 text-white", label: "WATCH" },
  alert: { ring: "border-red-600/60 bg-red-600/5", chip: "bg-red-600 text-white", label: "ALERT" },
} as const



export default function PredictionsPage() {
  const { t } = usePreferences()
  const { data } = useSWR<Predictions>("/analytics/predictions", (u: string) => api(u), { refreshInterval: 15_000 })
  const banner = data?.banner ? BANNER_STYLE[data.banner.state] : null

  return (
    <>
      <SiteHeader title={t("Predictions")} />
      <div className="space-y-6 p-4 lg:p-6">
        {/* Executive status banner — flips state live as alerts raise */}
        {data?.banner && banner && (
          <Card className={`border-2 shadow-lg ${banner.ring}`}>
            <CardContent className="flex items-start gap-4 p-5">
              <span className={`rounded-md px-3 py-1.5 text-sm font-bold tracking-wide ${banner.chip}`}>
                {t(banner.label)}
              </span>
              <div>
                <p className="font-semibold leading-snug">{data.banner.headline}</p>
                <p className="mt-1 text-sm text-muted-foreground">{data.banner.detail}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Headline summary */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-sm">{t("Projection summary")}</CardTitle>
            <CardDescription>
              <Badge variant="outline">
                {data?.granularity === "daily" ? t("Daily projection") : t("4-week projection")}
              </Badge>
              {data?.overall.forecastMethod === "rate-baseline" && (
                <Badge variant="secondary" className="ml-2">{t("Baseline projection")}</Badge>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SummaryLines lines={data?.topSummary ?? [t("Loading projections…")]} />
          </CardContent>
        </Card>


        {/* Overall mortality projection — graph, then its summary underneath */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-sm">{t("Mortality projection")}</CardTitle>
            <CardDescription>{t("Reported deaths vs forecast")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-72">
              <ProjectionChart series={data?.overall.series ?? []} forecast={data?.overall.forecast ?? []} nowMarker />
            </div>
            <SummaryLines lines={data?.overall.summary ?? []} />
          </CardContent>
        </Card>

        {/* Per cause-of-death projections — each card: graph + summary below */}
        <div className="grid gap-6 lg:grid-cols-2">
          {(data?.byCategory ?? []).map((c) => (
            <Card key={c.category} className="shadow-lg">
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-sm">{c.category}</CardTitle>
                  <CardDescription>{t("Recent deaths vs projected")}</CardDescription>
                </div>
                <TrendChip trend={c.trend} />
              </CardHeader>
              <CardContent className="space-y-4">
                {c.trend === "insufficient_data" ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">{t("Not enough data yet to chart a projection.")}</p>
                ) : (
                  <div className="h-52">
                    <ProjectionChart series={c.series} forecast={c.forecast} />
                  </div>
                )}
                <SummaryLines lines={c.summary} />
              </CardContent>
            </Card>
          ))}
          {data && !data.byCategory.length && (
            <Card className="shadow-lg">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                {t("No death notifications recorded yet — projections appear once cases are entered.")}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Geographic projection */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-sm">{t("Projected deaths by district")}</CardTitle>
            <CardDescription>{t("Share of the projected total, based on the last 90 days")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("District")}</TableHead>
                  <TableHead className="text-right">{t("Projected deaths")}</TableHead>
                  <TableHead className="text-right">{t("Share")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.byDistrict ?? []).map((d) => (
                  <TableRow key={d.district}>
                    <TableCell className="font-medium">{d.district}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.projected}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.sharePct}%</TableCell>
                  </TableRow>
                ))}
                {data && !data.byDistrict.length && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">{t("No data yet")}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
            <p className="mt-4 text-xs text-muted-foreground">
              {t("Statistical projections of reported deaths — decision support, not medical guidance.")}
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
