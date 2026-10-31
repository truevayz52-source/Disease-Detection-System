import useSWR from "swr"
import { InfoTooltip } from "@/components/info-tooltip"
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
  minCases: number
  casesRecorded: number
  observed: { totalDeaths: number; coveragePeriods: number; perPeriodRate: number }
  overall: { series: Point[]; forecast: ForecastPoint[]; directionPct: number; forecastMethod: "seasonal" | "regression" | "rate-baseline" | null; summary: string[] }
  byCategory: CategoryProjection[]
  byDistrict: { district: string; projected: number; sharePct: number; forecast?: { predicted: number }[] }[]
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

// Plain-language "how close are we to a real forecast" meter.
function DataReadiness({ have, need, unit }: { have: number; need: number; unit: string }) {
  const done = Math.min(have, need)
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">
        {Array.from({ length: need }, (_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-full ${i < done ? "bg-primary" : "bg-muted-foreground/25"}`} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {have} / {need} {unit}
      </p>
    </div>
  )
}

/** Velocity of a per-district forecast: compare first vs last predicted point. */
function trajectory(forecast?: { predicted: number }[]): CategoryProjection["trend"] {
  if (!forecast || forecast.length < 2) return "insufficient_data"
  const d = forecast[forecast.length - 1].predicted - forecast[0].predicted
  return d > 0.25 ? "rising" : d < -0.25 ? "falling" : "stable"
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
  const minCases = data?.minCases ?? 3
  const casesRecorded = data?.casesRecorded ?? 0
  const needsMore = !!data && casesRecorded < minCases

  const caseUnit = data ? "death notifications recorded" : ""

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

        {/* Headline answer — one big number, one plain sentence */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-sm">{t("Projection summary")}</CardTitle>
            <CardDescription>{t("What the system expects next, in plain terms")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!data ? (
              <SummaryLines lines={[t("Loading projections…")]} />
            ) : (
              <>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-4xl font-bold tabular-nums">~{data.metrics.projectedTotal}</span>
                  <span className="text-sm text-muted-foreground">
                    {t("projected death(s) over the")} {data.metrics.projectedPeriod}
                  </span>
                </div>
                {data.observed && data.observed.coveragePeriods > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("How this was estimated:")} {data.observed.totalDeaths} {t("reported death(s) over")}{" "}
                    {data.observed.coveragePeriods} {data.observed.coveragePeriods === 1 ? data.periodWord : `${data.periodWord}s`}{" "}
                    {t("of reporting")} ≈ {data.observed.perPeriodRate}/{data.periodWord},{" "}
                    {t("projected forward")}
                  </p>
                )}
                <Badge variant={data.overall.forecastMethod === "rate-baseline" ? "secondary" : "outline"}>
                  {data.overall.forecastMethod === "rate-baseline"
                    ? t("Rough estimate — limited history")
                    : t("Trend forecast")}
                </Badge>
                {data.overall.forecastMethod !== "rate-baseline" && data.metrics.projectedUpper > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("Likely range:")} {data.metrics.projectedLower}–{data.metrics.projectedUpper}
                  </p>
                )}

                {/* What it takes to get a stronger prediction */}
                <div className="rounded-md border bg-muted/30 p-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("Data needed for a reliable forecast")}
                  </p>
                  <DataReadiness have={casesRecorded} need={minCases} unit={caseUnit} />
                  {!needsMore && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("Enough history for full trend forecasts — accuracy keeps improving as more notifications are recorded.")}
                    </p>
                  )}
                </div>

                {data.topSummary.length > 1 && <SummaryLines lines={data.topSummary.slice(1)} />}
              </>
            )}
          </CardContent>
        </Card>


        {/* Overall mortality projection — graph, then its summary underneath */}
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-1.5">{t("Mortality projection")}<InfoTooltip text={t("Regression model fit on reported deaths — the dashed line is the model's forward projection.")} /></CardTitle>
            <CardDescription>{t("Solid line = deaths actually reported · Dashed line = forecast")}</CardDescription>
            {/* Objective 1 — forecast-confidence banner: states that forward
                modeling is running, which model, and over how much history */}
            {data?.overall.forecastMethod && (
              <p className="flex flex-wrap items-center gap-1.5 pt-1.5">
                <Badge variant="secondary" className="text-[10px] font-semibold">{t("Predictive modeling active")}</Badge>
                <span className="text-xs text-muted-foreground">
                  {data.overall.forecastMethod === "rate-baseline" ? t("Rate-baseline estimate") : data.overall.forecastMethod === "seasonal" ? t("Seasonal model") : t("Regression fit")}
                  {" · "}{data.observed.coveragePeriods} {t("reporting periods of history")} · {t("horizon:")} {data.metrics.projectedPeriod}
                </span>
              </p>
            )}
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
                  <div className="space-y-3 py-6">
                    <p className="text-center text-sm text-muted-foreground">
                      {t("Not enough history to chart a trend yet.")}
                    </p>
                    <div className="mx-auto max-w-xs">
                      <DataReadiness have={casesRecorded} need={minCases} unit={caseUnit} />
                    </div>
                    <p className="text-center text-xs text-muted-foreground">
                      {t("Trend labels unlock once enough death notifications are recorded.")}
                    </p>
                  </div>
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
                  <TableHead className="text-right">{t("Trajectory")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.byDistrict ?? []).map((d) => (
                  <TableRow key={d.district}>
                    <TableCell className="font-medium">{d.district}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.projected}</TableCell>
                    <TableCell className="text-right tabular-nums">{d.sharePct}%</TableCell>
                    {/* Objective 1 — trend velocity indicator per district */}
                    <TableCell className="text-right"><TrendChip trend={trajectory(d.forecast)} /></TableCell>
                  </TableRow>
                ))}
                {data && !data.byDistrict.length && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">{t("No data yet")}</TableCell></TableRow>
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
