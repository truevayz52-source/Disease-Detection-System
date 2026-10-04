import { Router } from "../lib/router.js"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"
import { detectOutbreaks } from "../lib/outbreak.js"
import { callPython, pythonHealth } from "../lib/analyticsClient.js"
import { writeAudit } from "../lib/audit.js"

export const analyticsRouter = Router()

const ANALYST_ROLES = ["public_health_analyst", "system_admin"] as const

// Dashboard KPIs — target <2s (Ch 3.11 performance requirement).
analyticsRouter.get("/summary", requireAuth, async (_req, res) => {
  const [deaths] = await query<any[]>(
    "SELECT COUNT(*) AS c FROM death_notifications WHERE date_of_death >= DATE_SUB(NOW(), INTERVAL 7 DAY)",
  )
  const [pending] = await query<any[]>(
    "SELECT COUNT(*) AS c FROM death_notifications WHERE status IN ('pending_review','under_review')",
  )
  const [alerts] = await query<any[]>("SELECT COUNT(*) AS c FROM outbreak_alerts WHERE status = 'active'")
  const [autopsies] = await query<any[]>("SELECT COUNT(*) AS c FROM autopsy_reports WHERE status = 'finalized'")
  const [mpdsr] = await query<any[]>(
    "SELECT COUNT(*) AS c FROM death_notifications WHERE is_maternal_perinatal = 1 AND date_of_death >= DATE_SUB(NOW(), INTERVAL 30 DAY)",
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
analyticsRouter.get("/dashboard", requireAuth, async (_req, res) => {
  const [kpi] = await query<any[]>(
    `SELECT
       SUM(date_of_death >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS deaths_7d,
       SUM(date_of_death >= DATE_SUB(NOW(), INTERVAL 14 DAY)
           AND date_of_death < DATE_SUB(NOW(), INTERVAL 7 DAY)) AS deaths_prev_7d,
       SUM(status IN ('pending_review','under_review')) AS pending_reviews,
       SUM(is_maternal_perinatal = 1 AND date_of_death >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS mpdsr_30d,
       SUM(is_maternal_perinatal = 1 AND date_of_death >= DATE_SUB(NOW(), INTERVAL 60 DAY)
           AND date_of_death < DATE_SUB(NOW(), INTERVAL 30 DAY)) AS mpdsr_prev_30d,
       COUNT(*) AS total
     FROM death_notifications`,
  )
  const [autopsies] = await query<any[]>(
    "SELECT COUNT(*) AS c FROM autopsy_reports WHERE status = 'finalized'",
  )
  const [alerts] = await query<any[]>(
    "SELECT COUNT(*) AS c FROM outbreak_alerts WHERE status = 'active'",
  )
  const daily = await query<any[]>(
    `SELECT DATE_FORMAT(date_of_death, '%Y-%m-%d') AS day, COUNT(*) AS count
     FROM death_notifications
     WHERE date_of_death >= DATE_SUB(NOW(), INTERVAL 30 DAY)
     GROUP BY day ORDER BY day`,
  )
  const byCategory = await query<any[]>(
    `SELECT ic.disease_category AS category, COUNT(*) AS count
     FROM death_notifications dn JOIN icd_codes ic ON ic.icd_code = dn.preliminary_icd_code
     WHERE dn.date_of_death >= DATE_SUB(NOW(), INTERVAL 90 DAY)
     GROUP BY category ORDER BY count DESC LIMIT 8`,
  )
  const byProvince = await query<any[]>(
    `SELECT f.province, COUNT(*) AS count
     FROM death_notifications dn JOIN facilities f ON f.facility_id = dn.facility_id
     WHERE dn.date_of_death >= DATE_SUB(NOW(), INTERVAL 90 DAY)
     GROUP BY f.province ORDER BY count DESC`,
  )
  const byStatus = await query<any[]>(
    "SELECT status, COUNT(*) AS count FROM death_notifications GROUP BY status",
  )
  const weekly = await query<any[]>(
    `SELECT YEARWEEK(date_of_death, 1) AS yw,
            DATE_FORMAT(MIN(date_of_death), '%Y-%m-%d') AS week, COUNT(*) AS count
     FROM death_notifications
     WHERE date_of_death >= DATE_SUB(NOW(), INTERVAL 12 WEEK)
     GROUP BY yw ORDER BY week`,
  )
  res.json({
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
  })
})

// Weekly mortality trend by category + naive least-squares forecast (Node fallback).
analyticsRouter.get("/trends", requireAuth, requireRole(...ANALYST_ROLES, "executive"), async (req, res) => {
  const weeks = Math.min(52, Math.max(4, Number(req.query.weeks ?? 12)))
  const rows = await query<any[]>(
    `SELECT YEARWEEK(dn.date_of_death, 1) AS yw,
            DATE_FORMAT(MIN(dn.date_of_death), '%Y-%m-%d') AS week_start,
            ic.disease_category AS category, COUNT(*) AS count
     FROM death_notifications dn JOIN icd_codes ic ON ic.icd_code = dn.preliminary_icd_code
     WHERE dn.date_of_death >= DATE_SUB(NOW(), INTERVAL ? WEEK)
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
    `SELECT dn.notification_id, dn.date_of_death, dn.preliminary_icd_code, ic.disease_category,
            p.latitude, p.longitude, f.facility_id, f.district,
            f.latitude AS facility_lat, f.longitude AS facility_lng
     FROM death_notifications dn
     JOIN patients p ON p.patient_id = dn.patient_id
     JOIN facilities f ON f.facility_id = dn.facility_id
     JOIN icd_codes ic ON ic.icd_code = dn.preliminary_icd_code
     WHERE dn.date_of_death >= DATE_SUB(NOW(), INTERVAL 90 DAY)`,
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
     JOIN patients p ON p.patient_id = dn.patient_id
     JOIN facilities f ON f.facility_id = dn.facility_id
     JOIN icd_codes ic ON ic.icd_code = dn.preliminary_icd_code
     WHERE dn.date_of_death >= DATE_SUB(NOW(), INTERVAL 90 DAY)`,
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
