import { Router } from "../lib/router.js"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { config } from "../config.js"
import { query } from "../db.js"
import { z } from "zod"
import { detectOutbreaks } from "../lib/outbreak.js"
import { callPython, pythonHealth } from "../lib/analyticsClient.js"
import { writeAudit } from "../lib/audit.js"
import { createNotification } from "../lib/notification-service.js"
import multer from "multer"
import { serviceJson } from "../lib/integrations.js"

export const analyticsRouter = Router()

const ANALYST_ROLES = ["public_health_analyst"] as const

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    // Accept common CSV MIME types, but we will sniff content as text.
    const ok = ["text/csv", "application/csv", "application/vnd.ms-excel", "application/octet-stream", "text/plain"].includes(file.mimetype)
    cb(null, ok)
  },
})

// Dashboard KPIs — target <2s (Ch 3.11 performance requirement).
analyticsRouter.get("/summary", requireAuth, async (_req, res) => {
  const [deaths] = await query<any[]>(
    "SELECT COUNT(*) AS c FROM death_notifications WHERE status <> 'rejected' AND date_of_death >= NOW() - INTERVAL '7 days'",
  )
  const [pending] = await query<any[]>(
    "SELECT COUNT(*) AS c FROM death_notifications WHERE status IN ('pending_review','under_review')",
  )
  const [alerts] = await query<any[]>("SELECT COUNT(*) AS c FROM outbreak_alerts WHERE status = 'active'")
  const [autopsies] = await query<any[]>("SELECT COUNT(*) AS c FROM autopsy_reports WHERE status = 'finalized'")
  const [mpdsr] = await query<any[]>(
    "SELECT COUNT(*) AS c FROM death_notifications WHERE status <> 'rejected' AND is_maternal_perinatal AND date_of_death >= NOW() - INTERVAL '30 days'",
  )
  const [total] = await query<any[]>("SELECT COUNT(*) AS c FROM death_notifications")
  res.json({
    deathsLast7Days: Number(deaths?.c ?? 0),
    pendingReviews: Number(pending?.c ?? 0),
    activeAlerts: Number(alerts?.c ?? 0),
    finalizedAutopsies: Number(autopsies?.c ?? 0),
    mpdsrLast30Days: Number(mpdsr?.c ?? 0),
    totalNotifications: Number(total?.c ?? 0),
  })
})

// Rich dashboard payload: KPI deltas, daily deaths series, category/province/status
// breakdowns. Open to all authenticated roles (the KPI data is non-sensitive
// aggregate counts); detailed analytics stay role-gated below.
// The hosted-DB link is slow — dashboard aggregates tolerate a minute of
// staleness, so cache the payload instead of paying the queries per request.
let dashCache: { at: number; payload: unknown } | null = null
const DASH_TTL_MS = 60_000

export async function getDashboardData() {
  // All 7 aggregates run concurrently — the hosted-DB link has ~220ms RTT,
  // so sequential queries stack up to ~2s; parallel is a few hundred ms.
  const [kpiRows, autopsyRows, alertRows, daily, byCategory, byProvince, byStatus, weekly] =
    await Promise.all([
      query<any[]>(
        `SELECT
           COUNT(*) FILTER (WHERE status <> 'rejected' AND date_of_death >= NOW() - INTERVAL '7 days') AS deaths_7d,
           COUNT(*) FILTER (WHERE status <> 'rejected' AND date_of_death >= NOW() - INTERVAL '14 days'
               AND date_of_death < NOW() - INTERVAL '7 days') AS deaths_prev_7d,
           COUNT(*) FILTER (WHERE status IN ('pending_review','under_review')) AS pending_reviews,
           COUNT(*) FILTER (WHERE status <> 'rejected' AND is_maternal_perinatal AND date_of_death >= NOW() - INTERVAL '30 days') AS mpdsr_30d,
           COUNT(*) FILTER (WHERE status <> 'rejected' AND is_maternal_perinatal AND date_of_death >= NOW() - INTERVAL '60 days'
               AND date_of_death < NOW() - INTERVAL '30 days') AS mpdsr_prev_30d,
           COUNT(*) AS total
         FROM death_notifications`,
      ),
      query<any[]>(
        "SELECT COUNT(*) AS c FROM autopsy_reports WHERE status = 'finalized'",
      ),
      query<any[]>(
        "SELECT COUNT(*) AS c FROM outbreak_alerts WHERE status = 'active'",
      ),
      query<any[]>(
        `SELECT TO_CHAR(date_of_death, 'YYYY-MM-DD') AS day, COUNT(*) AS count
         FROM death_notifications
         WHERE status <> 'rejected' AND date_of_death >= NOW() - INTERVAL '30 days'
         GROUP BY day ORDER BY day`,
      ),
      query<any[]>(
        `SELECT ic.disease_category AS category, COUNT(*) AS count
         FROM death_notifications dn
         LEFT JOIN (
           SELECT DISTINCT ON (notification_id) notification_id, final_icd_code
           FROM autopsy_reports WHERE status = 'finalized'
           ORDER BY notification_id, finalized_at DESC
         ) ar ON ar.notification_id = dn.notification_id
         JOIN icd_codes ic ON ic.icd_code = COALESCE(ar.final_icd_code, dn.preliminary_icd_code)
         WHERE dn.status <> 'rejected' AND dn.date_of_death >= NOW() - INTERVAL '90 days'
         GROUP BY category ORDER BY count DESC LIMIT 8`,
      ),
      query<any[]>(
        `SELECT f.province, COUNT(*) AS count
         FROM death_notifications dn JOIN facilities f ON f.facility_id = dn.facility_id
         WHERE dn.status <> 'rejected' AND dn.date_of_death >= NOW() - INTERVAL '90 days'
         GROUP BY f.province ORDER BY count DESC`,
      ),
      query<any[]>(
        "SELECT status, COUNT(*) AS count FROM death_notifications GROUP BY status",
      ),
      query<any[]>(
        `SELECT date_trunc('week', date_of_death) AS yw,
                TO_CHAR(date_trunc('week', date_of_death), 'YYYY-MM-DD') AS week, COUNT(*) AS count
         FROM death_notifications
         WHERE status <> 'rejected' AND date_of_death >= NOW() - INTERVAL '12 weeks'
         GROUP BY yw ORDER BY week`,
      ),
    ])
  const [kpi] = kpiRows
  const [autopsies] = autopsyRows
  const [alerts] = alertRows
  return {
    kpis: {
      deathsLast7Days: Number(kpi?.deaths_7d ?? 0),
      deathsPrev7Days: Number(kpi?.deaths_prev_7d ?? 0),
      pendingReviews: Number(kpi?.pending_reviews ?? 0),
      activeAlerts: Number(alerts?.c ?? 0),
      finalizedAutopsies: Number(autopsies?.c ?? 0),
      mpdsrLast30Days: Number(kpi?.mpdsr_30d ?? 0),
      mpdsrPrev30Days: Number(kpi?.mpdsr_prev_30d ?? 0),
      totalNotifications: Number(kpi?.total ?? 0),
    },
    daily: daily.map((r) => ({ day: r.day, count: Number(r.count) })),
    weekly: weekly.map((r) => ({ week: r.week, count: Number(r.count) })),
    byCategory: byCategory.map((r) => ({ category: r.category ?? "Other", count: Number(r.count) })),
    byProvince: byProvince.map((r) => ({ province: r.province ?? "Unknown", count: Number(r.count) })),
    byStatus: byStatus.map((r) => ({ status: r.status, count: Number(r.count) })),
  }
}

analyticsRouter.get("/dashboard", requireAuth, async (_req, res) => {
  if (dashCache && Date.now() - dashCache.at < DASH_TTL_MS) return res.json(dashCache.payload)
  const payload = await getDashboardData()
  dashCache = { at: Date.now(), payload }
  res.json(payload)
})

// Weekly mortality trend by category + naive least-squares forecast (Node fallback).
analyticsRouter.get("/trends", requireAuth, requireRole(...ANALYST_ROLES, "executive"), async (req, res) => {
  const weeks = Math.min(52, Math.max(4, Number(req.query.weeks ?? 12)))
  const rows = await query<any[]>(
    `SELECT date_trunc('week', dn.date_of_death) AS yw,
            TO_CHAR(date_trunc('week', dn.date_of_death), 'YYYY-MM-DD') AS week_start,
            ic.disease_category AS category, COUNT(*) AS count
     FROM death_notifications dn
     LEFT JOIN (
       SELECT DISTINCT ON (notification_id) notification_id, final_icd_code
       FROM autopsy_reports WHERE status = 'finalized'
       ORDER BY notification_id, finalized_at DESC
     ) ar ON ar.notification_id = dn.notification_id
     JOIN icd_codes ic ON ic.icd_code = COALESCE(ar.final_icd_code, dn.preliminary_icd_code)
     WHERE dn.status <> 'rejected' AND dn.date_of_death >= NOW() - (? * INTERVAL '1 week')
     GROUP BY yw, ic.disease_category
     ORDER BY week_start`,
    [weeks],
  )

  // Totals per week for forecasting.
  const totals = new Map<string, number>()
  for (const r of rows) totals.set(r.week_start, (totals.get(r.week_start) ?? 0) + Number(r.count))
  const series = [...totals.entries()].sort().map(([week, count]) => ({ week, count }))

  // Least-squares linear forecast for the next 4 weeks (Node fallback when
  // the Python service is down — sklearn does the same regression there).
  const n = series.length
  let forecast: { week: string; predicted: number }[] = []
  if (n >= 3) {
    const xs = series.map((_, i) => i)
    const ys = series.map((s) => s.count)
    const mx = xs.reduce((a, b) => a + b, 0) / n
    const my = ys.reduce((a, b) => a + b, 0) / n
    const slope = xs.reduce((acc, x, i) => acc + (x - mx) * (ys[i] - my), 0) / xs.reduce((acc, x) => acc + (x - mx) ** 2, 0)
    const intercept = my - slope * mx
    const last = new Date(series[n - 1].week)
    for (let k = 1; k <= 4; k++) {
      const d = new Date(last)
      d.setDate(d.getDate() + 7 * k)
      forecast.push({ week: d.toISOString().slice(0, 10), predicted: Math.max(0, Math.round(intercept + slope * (n - 1 + k))) })
    }
  }
  res.json({ rows, series, forecast })
})

// Case points + facilities for the Leaflet surveillance map.
analyticsRouter.get("/geo", requireAuth, requireRole(...ANALYST_ROLES), async (_req, res) => {
  const facilities = await query<any[]>(
    "SELECT facility_id, facility_name, province, district, latitude, longitude, facility_type FROM facilities",
  )
  const cases = await query<any[]>(
    `SELECT dn.notification_id, dn.date_of_death, COALESCE(ar.final_icd_code, dn.preliminary_icd_code) AS icd_code, ic.disease_category,
            p.latitude, p.longitude, f.facility_id, f.district,
            f.latitude AS facility_lat, f.longitude AS facility_lng
     FROM death_notifications dn
     LEFT JOIN (
       SELECT DISTINCT ON (notification_id) notification_id, final_icd_code
       FROM autopsy_reports WHERE status = 'finalized'
       ORDER BY notification_id, finalized_at DESC
     ) ar ON ar.notification_id = dn.notification_id
     JOIN patients p ON p.patient_id = dn.patient_id
     JOIN facilities f ON f.facility_id = dn.facility_id
     JOIN icd_codes ic ON ic.icd_code = COALESCE(ar.final_icd_code, dn.preliminary_icd_code)
     WHERE dn.status <> 'rejected' AND dn.date_of_death >= NOW() - INTERVAL '90 days'`,
  )
  // Fall back to facility coordinates when a patient has no address coords.
  const points = cases.map((c) => ({
    ...c,
    latitude: c.latitude ?? c.facility_lat,
    longitude: c.longitude ?? c.facility_lng,
  }))
  res.json({ facilities, cases: points })
})

// Run detection on demand (used by "detect now" button + tests).
analyticsRouter.post(
  "/detect",
  requireAuth,
  requireRole(...ANALYST_ROLES),
  async (req, res) => {
    const created = await detectOutbreaks()
    if (created.length) {
      await writeAudit(req, {
        action: "run_outbreak_detection",
        entityType: "outbreak_alerts",
        details: { created: created.length, alerts: created.map((a) => a.alertId) },
      })
    }
    res.json({ created })
  },
)

// ML clustering — tries the FastAPI scikit-learn service, falls back to Node
// district+category grouping so the page always returns data (Ch 5.3).
analyticsRouter.get("/clusters", requireAuth, requireRole(...ANALYST_ROLES), async (_req, res) => {
  const cases = await query<any[]>(
    `SELECT dn.notification_id AS id, ic.disease_category AS category,
            COALESCE(p.latitude, f.latitude) AS lat, COALESCE(p.longitude, f.longitude) AS lng,
            f.district, f.province, dn.date_of_death
     FROM death_notifications dn
     LEFT JOIN (
       SELECT DISTINCT ON (notification_id) notification_id, final_icd_code
       FROM autopsy_reports WHERE status = 'finalized'
       ORDER BY notification_id, finalized_at DESC
     ) ar ON ar.notification_id = dn.notification_id
     JOIN patients p ON p.patient_id = dn.patient_id
     JOIN facilities f ON f.facility_id = dn.facility_id
     JOIN icd_codes ic ON ic.icd_code = COALESCE(ar.final_icd_code, dn.preliminary_icd_code)
     WHERE dn.status <> 'rejected' AND dn.date_of_death >= NOW() - INTERVAL '90 days'`,
  )

  type Cluster = { category: string; district?: string; province?: string; count: number; centroid_lat: number; centroid_lng: number; ids: string[]; source: string }
  const pyResult = await callPython<{ clusters: Omit<Cluster, "source">[] }>("/cluster", { points: cases, eps_km: 25 })
  if (pyResult) {
    return res.json({ engine: "python-sklearn", clusters: pyResult.clusters.map((c) => ({ ...c, source: "python" })) })
  }

  // Node fallback: group by category+district, centroid = mean of points.
  const groups = new Map<string, typeof cases>()
  for (const c of cases) {
    const key = `${c.category}||${c.district}||${c.province}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(c)
  }
  const clusters: Cluster[] = [...groups.entries()].map(([key, pts]) => {
    const [category, district, province] = key.split("||")
    const lat = pts.reduce((a, p) => a + Number(p.lat), 0) / pts.length
    const lng = pts.reduce((a, p) => a + Number(p.lng), 0) / pts.length
    return { category, district, province, count: pts.length, centroid_lat: lat, centroid_lng: lng, ids: pts.map((p) => p.id), source: "node" }
  })
  res.json({ engine: "node-fallback", clusters })
})

analyticsRouter.get("/engine-status", requireAuth, async (_req, res) => {
  res.json({ python: await pythonHealth() })
})

// ---------------------------------------------------------------------------
// Predictions — overall + per-category mortality projections with
// deterministic plain-language summaries (no AI). Powers /predictions, where
// every graph is paired with the summary lines describing it.
// ---------------------------------------------------------------------------

interface PredPoint { label: string; count: number }
interface PredForecast { label: string; predicted: number; lower?: number; upper?: number }

function linearRegressionSeries(counts: number[]): { slope: number; intercept: number } {
  const n = counts.length
  const xs = counts.map((_, i) => i)
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = counts.reduce((a, b) => a + b, 0) / n
  const slope = xs.reduce((acc, x, i) => acc + (x - mx) * (counts[i] - my), 0) /
    xs.reduce((acc, x) => acc + (x - mx) ** 2, 0)
  return { slope, intercept: my - slope * mx }
}

interface ForecastResult {
  preds: number[]
  lower: number[]
  upper: number[]
  method: "seasonal" | "regression" | "rate-baseline"
}

/** Forecast `periods` ahead — sklearn via the FastAPI service with optional
 *  Fourier seasonality, then Node regression, then a rate-based baseline when
 *  history is too short for a regression. Returns an approximate 95% band. */
async function forecastCounts(counts: number[], periods: number, seasonal = 0): Promise<ForecastResult | null> {
  if (!counts.length) return null
  if (counts.length >= config.predictionsMinPoints) {
    const py = await callPython<{ forecast: { index: number; predicted: number; lower: number; upper: number }[]; method: string }>(
      "/forecast",
      { series: counts.map((count, index) => ({ index, count })), periods, seasonal },
    )
    if (py?.forecast?.length) {
      return {
        preds: py.forecast.map((f) => f.predicted),
        lower: py.forecast.map((f) => f.lower),
        upper: py.forecast.map((f) => f.upper),
        method: py.method === "seasonal" ? "seasonal" : "regression",
      }
    }
    const { slope, intercept } = linearRegressionSeries(counts)
    const preds = Array.from({ length: periods }, (_, k) =>
      Math.max(0, Math.round((intercept + slope * (counts.length + k)) * 10) / 10))
    return { preds, lower: preds.map(() => 0), upper: [...preds], method: "regression" }
  }
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length
  const preds = Array.from({ length: periods }, () => Math.max(0, Math.round(mean * 10) / 10))
  return { preds, lower: preds.map(() => 0), upper: [...preds], method: "rate-baseline" }
}

interface BatchInput { id: string; counts: number[]; periods: number; seasonal: number; daily: boolean; lastLabel: string }
async function batchForecast(inputs: BatchInput[]): Promise<Record<string, { preds: number[]; lower: number[]; upper: number[]; method: string; labels: string[] } | null>> {
  if (!inputs.length) return {}
  const valid = inputs.filter((i) => i.counts.length >= config.predictionsMinPoints)
  if (!valid.length) return Object.fromEntries(inputs.map((i) => [i.id, null]))
  const py = await callPython<{ items: { id: string; forecast: { index: number; predicted: number; lower: number; upper: number }[]; method: string }[] }>(
    "/forecast-batch",
    {
      items: valid.map((i) => ({
        id: i.id,
        series: i.counts.map((count, index) => ({ index, count })),
        periods: i.periods,
        seasonal: i.seasonal,
      })),
    },
  )
  const out: Record<string, { preds: number[]; lower: number[]; upper: number[]; method: string; labels: string[] } | null> = Object.fromEntries(inputs.map((i) => [i.id, null]))
  for (const item of py?.items ?? []) {
    const input = inputs.find((i) => i.id === item.id)
    if (!input) continue
    const labels = item.forecast.map((_, k) => stepLabel(input.lastLabel, k + 1, input.daily))
    out[item.id] = {
      preds: item.forecast.map((f) => f.predicted),
      lower: item.forecast.map((f) => f.lower),
      upper: item.forecast.map((f) => f.upper),
      method: item.method,
      labels,
    }
  }
  return out
}

function stepLabel(lastIso: string, step: number, daily: boolean): string {
  const d = new Date(lastIso)
  d.setDate(d.getDate() + (daily ? 1 : 7) * step)
  return d.toISOString().slice(0, 10)
}

function trendWord(slope: number, mean: number): "rising" | "falling" | "stable" {
  if (mean <= 0) return "stable"
  const rel = slope / mean
  return rel > 0.1 ? "rising" : rel < -0.1 ? "falling" : "stable"
}

function pct(n: number): string {
  return `${Math.round(Math.abs(n))}%`
}

// Short-lived cache — predictions re-run all queries plus per-category Python
// forecasts; 60 s of staleness is fine for analytics (same TTL as dashboard).
let predCache: { at: number; payload: unknown } | null = null
const PRED_TTL_MS = 60_000

analyticsRouter.get(
  "/predictions",
  requireAuth,
  requireRole(...ANALYST_ROLES, "executive"),
  async (_req, res) => {
    if (predCache && Date.now() - predCache.at < PRED_TTL_MS) return res.json(predCache.payload)
    // Weekly buckets over 26 weeks + daily buckets over 30 days. Daily exists
    // so fresh manual input still produces a projection before 3 full weeks
    // of history accumulate.
    const [weeklyRows, dailyRows, districtRows, activeAlertRows] = await Promise.all([
      query<any[]>(
        `SELECT date_trunc('week', dn.date_of_death) AS b,
                TO_CHAR(date_trunc('week', dn.date_of_death), 'YYYY-MM-DD') AS label,
                ic.disease_category AS category, COUNT(*) AS count
         FROM death_notifications dn
         LEFT JOIN (
           SELECT DISTINCT ON (notification_id) notification_id, final_icd_code
           FROM autopsy_reports WHERE status = 'finalized'
           ORDER BY notification_id, finalized_at DESC
         ) ar ON ar.notification_id = dn.notification_id
         JOIN icd_codes ic ON ic.icd_code = COALESCE(ar.final_icd_code, dn.preliminary_icd_code)
         WHERE dn.status <> 'rejected' AND dn.date_of_death >= NOW() - INTERVAL '26 weeks'
         GROUP BY b, category ORDER BY label`,
      ),
      query<any[]>(
        `SELECT date_trunc('day', dn.date_of_death) AS b,
                TO_CHAR(date_trunc('day', dn.date_of_death), 'YYYY-MM-DD') AS label,
                ic.disease_category AS category, COUNT(*) AS count
         FROM death_notifications dn
         LEFT JOIN (
           SELECT DISTINCT ON (notification_id) notification_id, final_icd_code
           FROM autopsy_reports WHERE status = 'finalized'
           ORDER BY notification_id, finalized_at DESC
         ) ar ON ar.notification_id = dn.notification_id
         JOIN icd_codes ic ON ic.icd_code = COALESCE(ar.final_icd_code, dn.preliminary_icd_code)
         WHERE dn.status <> 'rejected' AND dn.date_of_death >= NOW() - INTERVAL '30 days'
         GROUP BY b, category ORDER BY label`,
      ),
      query<any[]>(
        `SELECT f.district, COUNT(*) AS count
         FROM death_notifications dn JOIN facilities f ON f.facility_id = dn.facility_id
         WHERE dn.status <> 'rejected' AND dn.date_of_death >= NOW() - INTERVAL '90 days'
         GROUP BY f.district ORDER BY count DESC`,
      ),
      query<any[]>(
        `SELECT alert_type, district, disease_category, case_count
         FROM outbreak_alerts WHERE status = 'active' ORDER BY triggered_date DESC`,
      ),
    ])

    const weeklySeriesTotal = [...new Set(weeklyRows.map((r) => r.label))]
    const daily = weeklySeriesTotal.length < 3
    const rows = daily ? dailyRows : weeklyRows
    const periods = daily ? 7 : 4
    const periodWord = daily ? "day" : "week"
    const horizonPhrase = daily ? "next 7 days" : "next 4 weeks"

    // Per-district time series — uses the same granularity as the overall series.
    const districtSeriesRows = await query<any[]>(
      `SELECT f.district,
              TO_CHAR(date_trunc('${daily ? "day" : "week"}', dn.date_of_death), 'YYYY-MM-DD') AS label,
              COUNT(*) AS count
       FROM death_notifications dn JOIN facilities f ON f.facility_id = dn.facility_id
       WHERE dn.status <> 'rejected' AND dn.date_of_death >= NOW() - INTERVAL '${daily ? "30 days" : "26 weeks"}'
       GROUP BY f.district, date_trunc('${daily ? "day" : "week"}', dn.date_of_death) ORDER BY f.district, label`,
    )

    // Bucket -> {category -> count}
    const labels = [...new Set(rows.map((r) => r.label))].sort()
    const byCat = new Map<string, number[]>()
    const totals = labels.map(() => 0)
    for (const r of rows) {
      const i = labels.indexOf(r.label)
      const c = Number(r.count)
      totals[i] += c
      if (!byCat.has(r.category)) byCat.set(r.category, labels.map(() => 0))
      byCat.get(r.category)![i] += c
    }

    const series: PredPoint[] = labels.map((label, i) => ({ label, count: totals[i] }))
    const seasonalPeriod = daily ? 365 : 52
    const overallPreds = await forecastCounts(totals, periods, seasonalPeriod)
    const forecast: PredForecast[] = overallPreds
      ? overallPreds.preds.map((predicted, k) => ({
          label: stepLabel(labels[labels.length - 1], k + 1, daily),
          predicted,
          lower: overallPreds.lower[k],
          upper: overallPreds.upper[k],
        }))
      : []

    // Direction: projected per-period mean vs observed per-period mean —
    // honest even when fewer observed periods than forecast periods exist.
    const horizonTotal = Math.round(forecast.reduce((a, f) => a + f.predicted, 0))
    const horizonLower = forecast.length ? Math.round(forecast.reduce((a, f) => a + (f.lower ?? 0), 0)) : 0
    const horizonUpper = forecast.length ? Math.round(forecast.reduce((a, f) => a + (f.upper ?? 0), 0)) : 0
    const observedMean = totals.reduce((a, b) => a + b, 0) / Math.max(1, totals.length)
    const forecastMean = forecast.length ? horizonTotal / forecast.length : 0
    const directionPct = observedMean > 0 ? ((forecastMean - observedMean) / observedMean) * 100 : 0

    const overallSummary: string[] = []
    if (!series.length) {
      overallSummary.push("Not enough reported deaths yet to project a trend — at least one reporting period is needed.")
    } else if (overallPreds?.method === "rate-baseline") {
      overallSummary.push(
        `Baseline projection — about ${horizonTotal} death(s) are expected over the ${horizonPhrase} at the recent reporting rate. Accuracy improves as more history accumulates.`,
      )
    } else {
      const change = `running ${pct(directionPct)} ${directionPct >= 0 ? "above" : "below"} the recent ${daily ? "daily" : "weekly"} average`
      overallSummary.push(
        `About ${horizonTotal} death(s) are projected over the ${horizonPhrase} (range ${horizonLower}–${horizonUpper}) — ${change}.`,
      )
    }

    // Per-category projections + summaries. All forecastCounts calls run
    // concurrently — they were previously sequential N× Python round-trips.
    const catEntries = [...byCat.entries()].sort()
    const catPredsList = await Promise.all(catEntries.map(([, counts]) => forecastCounts(counts, periods, seasonalPeriod)))
    const byCategory = [] as any[]
    for (let ci = 0; ci < catEntries.length; ci++) {
      const [category, counts] = catEntries[ci]
      const mean = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length)
      const { slope } = counts.length >= config.predictionsMinPoints ? linearRegressionSeries(counts) : { slope: 0 }
      const preds = catPredsList[ci]
      const trend = counts.length < config.predictionsMinPoints ? "insufficient_data" : trendWord(slope, mean)
      const catHorizon = preds ? Math.round(preds.preds.reduce((a, p) => a + p, 0)) : 0
      const catLower = preds ? Math.round(preds.lower.reduce((a, p) => a + p, 0)) : 0
      const catUpper = preds ? Math.round(preds.upper.reduce((a, p) => a + p, 0)) : 0
      const summary: string[] = []
      if (trend === "insufficient_data") {
        summary.push(preds?.method === "rate-baseline"
          ? `Only ${counts.length} reporting period(s) so far — at the current rate roughly ${catHorizon} ${category} death(s) are expected over the ${horizonPhrase}; the trend label needs more history.`
          : "Not enough data yet — at least three reporting periods with this category are needed for a projection.")
      } else {
        const verb = trend === "rising" ? "rising" : trend === "falling" ? "declining" : "holding steady"
        summary.push(`${category} deaths are ${verb}; roughly ${catHorizon} (${catLower}–${catUpper}) more are projected over the ${horizonPhrase}.`)
      }
      byCategory.push({
        category,
        trend,
        series: labels.map((label, i) => ({ label, count: counts[i] })),
        forecast: (preds?.preds ?? []).map((predicted, k) => ({
          label: stepLabel(labels[labels.length - 1], k + 1, daily),
          predicted,
          lower: preds?.lower[k] ?? 0,
          upper: preds?.upper[k] ?? 0,
        })),
        forecastMethod: preds?.method ?? null,
        horizonTotal: catHorizon,
        horizonLower: catLower,
        horizonUpper: catUpper,
        summary,
      })
    }
    byCategory.sort((a, b) => b.horizonTotal - a.horizonTotal)

    // Geographic projection: per-district time-series forecast for the top 10 districts.
    const districtTotal = districtRows.reduce((a, r) => a + Number(r.count), 0)
    const districtByLabel = new Map<string, Map<string, number>>()
    for (const r of districtSeriesRows) {
      if (!districtByLabel.has(r.district)) districtByLabel.set(r.district, new Map())
      districtByLabel.get(r.district)!.set(r.label, Number(r.count))
    }
    const topDistricts = districtRows.slice(0, 10).map((r) => r.district)
    const districtInputs: BatchInput[] = topDistricts.map((district) => ({
      id: district,
      counts: labels.map((l) => districtByLabel.get(district)?.get(l) ?? 0),
      periods,
      seasonal: seasonalPeriod,
      daily,
      lastLabel: labels[labels.length - 1],
    }))
    const districtForecasts = await batchForecast(districtInputs)
    const byDistrict = districtRows.slice(0, 10).map((r) => {
      const f = districtForecasts[r.district]
      const projected = f ? Math.round(f.preds.reduce((a, p) => a + p, 0)) : 0
      const lower = f ? Math.round(f.lower.reduce((a, p) => a + p, 0)) : 0
      const upper = f ? Math.round(f.upper.reduce((a, p) => a + p, 0)) : 0
      const share = districtTotal > 0 ? Number(r.count) / districtTotal : 0
      return {
        district: r.district ?? "Unknown",
        projected,
        lower,
        upper,
        sharePct: Math.round(share * 100),
        forecast: f ? f.preds.map((predicted, k) => ({ label: f.labels[k], predicted, lower: f.lower[k], upper: f.upper[k] })) : [],
      }
    })

    const rising = byCategory.filter((c) => c.trend === "rising")
    const topSummary: string[] = [...overallSummary]
    if (rising.length) topSummary.push(`${rising[0].category} is the fastest-rising cause-of-death category.`)
    if (byDistrict[0]?.sharePct) topSummary.push(`${byDistrict[0].district} accounts for about ${byDistrict[0].sharePct}% of projected deaths.`)

    // --- Presentation layer: status banner + objectives scorecard ----------
    // Banner is a 3-state escalation: red for confirmed outbreak/MPDSR, amber
    // for early warnings only, green when quiet — all wording derived from
    // the live rows, no fixed figures.
    const confirmed = activeAlertRows.filter((a) => a.alert_type !== "early_warning")
    const topAlert = confirmed[0] ?? activeAlertRows[0] ?? null
    const banner = confirmed.length
      ? {
          state: "alert" as const,
          headline: `Outbreak alert active — ${topAlert.disease_category} cluster in ${topAlert.district}`,
          detail: `${Number(topAlert.case_count)} cases on record. Projected ${horizonTotal} death(s) over the ${horizonPhrase} at the current trajectory.`,
        }
      : topAlert
        ? {
            state: "watch" as const,
            headline: `Early warning — ${Number(topAlert.case_count)} ${topAlert.disease_category} death(s) in ${topAlert.district}`,
            detail: `Low-volume cluster under surveillance. Projected ${horizonTotal} death(s) over the ${horizonPhrase} at the current rate.`,
          }
        : {
            state: "stable" as const,
            headline: "Baseline stable — mortality within expected limits",
            detail: series.length
              ? `Projected ${horizonTotal} death(s) over the ${horizonPhrase} at the recent ${daily ? "daily" : "weekly"} average.`
              : "No deaths on record yet — projections appear once notifications are entered.",
          }

    const objectives = [
      {
        key: "prediction",
        status: forecast.length ? "active" : "pending",
        detail: forecast.length
          ? `${overallPreds?.method === "rate-baseline" ? "Rate baseline" : "Regression"} projection — ${horizonTotal} death(s) over the ${horizonPhrase}`
          : "Waiting for enough reported deaths to project",
      },
      {
        key: "detection",
        status: topAlert ? "flagged" : "monitoring",
        detail: topAlert
          ? `${topAlert.alert_type === "early_warning" ? "Early warning" : "Outbreak alert"}: ${topAlert.district}, ${Number(topAlert.case_count)} case(s)`
          : "No active alerts — surveillance running",
      },
      {
        key: "patterns",
        status: byCategory.length ? "identified" : "waiting",
        detail: byCategory.length
          ? `Dominant category: ${byCategory[0].category}`
          : "Waiting for cause-of-death data",
      },
    ]

    const payload = {
      granularity: daily ? "daily" : "weekly",
      periodWord,
      overall: { series, forecast, directionPct: Math.round(directionPct), forecastMethod: overallPreds?.method ?? null, summary: overallSummary },
      byCategory,
      byDistrict,
      topSummary,
      banner,
      activeAlertCount: activeAlertRows.length,
      metrics: {
        projectedTotal: horizonTotal,
        projectedLower: horizonLower,
        projectedUpper: horizonUpper,
        projectedPeriod: horizonPhrase,
        projectedMethod: overallPreds?.method ?? null,
        activeAlerts: activeAlertRows.length,
        topCategory: byCategory[0]?.category ?? null,
        topCategoryProjected: byCategory[0]?.horizonTotal ?? 0,
      },
      objectives,
    }
    predCache = { at: Date.now(), payload }
    res.json(payload)
  },
)

// Bulk data ingest — JSON array of death notifications. Useful for back-filling
// facility registers or lab extracts without entering each case manually.
// Creates each notification through the same validation path as the UI/mobile,
// then runs a full outbreak scan at the end.
analyticsRouter.post(
  "/ingest",
  requireAuth,
  requireRole(...ANALYST_ROLES, "system_admin"),
  async (req, res) => {
    const schema = z.object({
      notifications: z.array(z.record(z.string(), z.unknown())).min(1).max(500),
    })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload: expected { notifications: [...] }" })
    const { notifications } = parsed.data
    let imported = 0
    const errors: string[] = []
    for (const [i, input] of notifications.entries()) {
      try {
        await createNotification(req, input)
        imported++
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown"
        errors.push(`Row ${i}: ${msg}`)
      }
    }
    const created = await detectOutbreaks().catch(() => [])
    await writeAudit(req, { action: "bulk_ingest", entityType: "death_notifications", details: { imported, errors: errors.length, alerts: created.length } })
    res.json({ imported, errors, alertsCreated: created.length })
  },
)

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const next = text[i + 1]
    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"'
        i++
      } else if (c === '"') {
        inQuotes = false
      } else {
        field += c
      }
    } else {
      if (c === '"') {
        inQuotes = true
      } else if (c === ',') {
        row.push(field)
        field = ""
      } else if (c === '\n') {
        if (field !== "" || row.length > 0) {
          row.push(field)
          rows.push(row)
          row = []
          field = ""
        }
      } else if (c === '\r') {
        // skip; optional LF handled by next iteration
      } else {
        field += c
      }
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

analyticsRouter.post(
  "/ingest/csv",
  requireAuth,
  requireRole(...ANALYST_ROLES, "system_admin"),
  csvUpload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No CSV file uploaded" })
    const text = req.file.buffer.toString("utf-8").replace(/^\uFEFF/, "")
    const parsed = parseCsv(text)
    const MAX_CSV_ROWS = 500
    if (parsed.length - 1 > MAX_CSV_ROWS) return res.status(400).json({ error: `CSV exceeds ${MAX_CSV_ROWS} rows` })
    if (parsed.length < 2) return res.status(400).json({ error: "CSV has no data rows" })
    const headers = parsed[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"))
    const headerIndex = new Map<string, number>()
    for (let i = 0; i < headers.length; i++) headerIndex.set(headers[i], i)
    const get = (row: string[], ...names: string[]) => {
      for (const n of names) {
        const i = headerIndex.get(n)
        if (i !== undefined) return row[i] ?? ""
      }
      return ""
    }
    let imported = 0
    const errors: string[] = []
    for (let r = 1; r < parsed.length; r++) {
      const row = parsed[r]
      if (row.every((c) => c.trim() === "")) continue
      const facilityId = get(row, "facility_id", "facility", "facilityid")
      const dateOfDeath = get(row, "date_of_death", "dateofdeath", "date")
      const preliminaryIcdCode = get(row, "preliminary_icd_code", "preliminaryicdcode", "icd_code", "icdcode", "icd")
      const fullName = get(row, "full_name", "fullname", "name")
      const gender = get(row, "gender", "sex")
      if (!facilityId || !dateOfDeath || !preliminaryIcdCode || !fullName || !gender) {
        errors.push(`Row ${r}: missing required column`)
        continue
      }
      const toNum = (v: string) => {
        const s = v.trim()
        if (s === "") return null
        const n = Number(s)
        return Number.isNaN(n) ? null : n
      }
      const payload = {
        patient: {
          fullName,
          age: toNum(get(row, "age")),
          gender: gender.toLowerCase() as any,
          nationalId: get(row, "national_id", "nationalid") || null,
          residentialAddress: get(row, "residential_address", "residentialaddress", "address") || null,
          latitude: toNum(get(row, "latitude", "lat")),
          longitude: toNum(get(row, "longitude", "lng", "long")),
        },
        facilityId,
        dateOfDeath,
        preliminaryIcdCode,
        clinicalSummary: get(row, "clinical_summary", "clinicalsummary", "summary") || "",
        isMaternalPerinatal: ["true", "1", "yes", "y"].includes(get(row, "is_maternal_perinatal", "ismaternalperinatal", "maternal").toLowerCase()),
      }
      try {
        await createNotification(req, payload as any)
        imported++
      } catch (e) {
        const msg = e instanceof Error ? e.message : "unknown"
        errors.push(`Row ${r}: ${msg}`)
      }
    }
    const created = await detectOutbreaks().catch(() => [])
    await writeAudit(req, { action: "csv_ingest", entityType: "death_notifications", details: { imported, errors: errors.length, alerts: created.length } })
    res.json({ imported, errors, alertsCreated: created.length })
  },
)

analyticsRouter.post(
  "/ingest/dhis2",
  requireAuth,
  requireRole(...ANALYST_ROLES, "system_admin"),
  async (req, res) => {
    const d = z.object({
      period: z.string().regex(/^\d{4}(\d{2})?$/).optional(),
      facilityId: z.string().min(1),
    }).parse(req.body)
    const period = d.period ?? (() => {
      const now = new Date()
      return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`
    })()
    const year = Number(period.slice(0, 4))
    const month = period.length === 6 ? Number(period.slice(4, 6)) : null
    const daysInMonth = month ? new Date(year, month, 0).getDate() : 1
    const base = (process.env.DHIS2_BASE_URL || "").replace(/\/+$/, "")
    if (!base) return res.status(503).json({ error: "DHIS2 is not configured" })
    const auth = process.env.DHIS2_API_TOKEN
      ? `ApiToken ${process.env.DHIS2_API_TOKEN}`
      : `Basic ${Buffer.from(`${process.env.DHIS2_USERNAME}:${process.env.DHIS2_PASSWORD}`).toString("base64")}`
    const url = `${base}/api/dataValueSets?dataSet=${process.env.DHIS2_DATASET}&period=${period}&orgUnit=${process.env.DHIS2_ORGUNIT}`
    const data = (await serviceJson(url, { headers: { authorization: auth } })) as any
    const values = data?.dataValues || []
    const elementMap: Record<string, string> = {}
    try {
      const m = JSON.parse(process.env.DHIS2_ELEMENT_MAP || "{}") as Record<string, string>
      for (const [cat, el] of Object.entries(m)) {
        if (typeof el === "string") elementMap[el] = cat
      }
    } catch {
      return res.status(400).json({ error: "DHIS2_ELEMENT_MAP is not valid JSON" })
    }
    const categoryIcd: Record<string, string | null> = {}
    let imported = 0
    const errors: string[] = []
    for (const dv of values) {
      const category = elementMap[dv.dataElement]
      if (!category) continue
      if (!(category in categoryIcd)) {
        const [row] = await query<any[]>("SELECT icd_code FROM icd_codes WHERE disease_category = ? ORDER BY icd_code LIMIT 1", [category])
        categoryIcd[category] = row?.icd_code ?? null
      }
      const icd = categoryIcd[category]
      if (!icd) {
        errors.push(`No ICD code for category ${category}`)
        continue
      }
      const count = Math.min(Number(dv.value) || 0, 1000)
      for (let i = 0; i < count; i++) {
        const day = month ? (i % daysInMonth) + 1 : 1
        const monthStr = month ? String(month).padStart(2, "0") : "01"
        const dayStr = String(day).padStart(2, "0")
        const payload = {
          patient: { fullName: "DHIS2 import", age: null, gender: "other" as const, nationalId: null, residentialAddress: null, latitude: null, longitude: null },
          facilityId: d.facilityId,
          dateOfDeath: `${year}-${monthStr}-${dayStr}`,
          preliminaryIcdCode: icd,
          clinicalSummary: `Imported from DHIS2 ${period} dataElement ${dv.dataElement}`,
          isMaternalPerinatal: ["Maternal", "Perinatal"].includes(category),
        }
        try {
          await createNotification(req, payload as any)
          imported++
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown"
          errors.push(`${category}: ${msg}`)
          break
        }
      }
    }
    const created = await detectOutbreaks().catch(() => [])
    await writeAudit(req, { action: "dhis2_ingest", entityType: "death_notifications", details: { imported, errors: errors.length, alerts: created.length, period } })
    res.json({ imported, errors, alertsCreated: created.length, period })
  },
)
