import { Router } from "../lib/router.js"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"
import { writeAudit } from "../lib/audit.js"

export const alertsRouter = Router()

alertsRouter.get("/", requireAuth, async (req, res) => {
  const where: string[] = []
  const params: any[] = []
  if (req.query.status) {
    where.push("status = ?")
    params.push(String(req.query.status))
  }
  if (req.query.type) {
    where.push("alert_type = ?")
    params.push(String(req.query.type))
  }
  const rows = await query<any[]>(
    `SELECT alert_id, disease_category, district, cluster_data, case_count, risk_score,
            alert_type, triggered_date, status, dispatched_channels, resolved_at
     FROM outbreak_alerts ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY triggered_date DESC LIMIT 200`,
    params,
  )
  res.json({ items: rows.map(row => req.user!.role === "executive" ? { ...row, cluster_data: null } : row) })
})

alertsRouter.get("/stats", requireAuth, async (_req, res) => {
  const rows = await query<any[]>(
    `SELECT
       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
       SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
       SUM(CASE WHEN status = 'active' AND risk_score >= 75 THEN 1 ELSE 0 END) AS critical,
       SUM(CASE WHEN status = 'active' AND risk_score >= 50 AND risk_score < 75 THEN 1 ELSE 0 END) AS high_risk,
       SUM(CASE WHEN status = 'active' THEN case_count ELSE 0 END) AS active_cases,
       COUNT(*) AS total
     FROM outbreak_alerts`,
  )
  const r = rows[0] ?? {}
  res.json({
    active: Number(r.active ?? 0),
    resolved: Number(r.resolved ?? 0),
    critical: Number(r.critical ?? 0),
    highRisk: Number(r.high_risk ?? 0),
    activeCases: Number(r.active_cases ?? 0),
    total: Number(r.total ?? 0),
  })
})

alertsRouter.get("/active-count", requireAuth, async (_req, res) => {
  const rows = await query<any[]>("SELECT COUNT(*) AS count FROM outbreak_alerts WHERE status = 'active'")
  res.json({ count: Number(rows[0]?.count ?? 0) })
})

alertsRouter.patch("/:id/resolve", requireAuth, requireRole("public_health_analyst", "system_admin"), async (req, res) => {
  const result = await query<any>(
    "UPDATE outbreak_alerts SET status = 'resolved', resolved_at = NOW() WHERE alert_id = ? AND status = 'active'",
    [req.params.id],
  )
  if (!result.affectedRows) return res.status(404).json({ error: "Active alert not found" })
  await writeAudit(req, { action: "resolve_alert", entityType: "outbreak_alerts", entityId: req.params.id })
  res.json({ ok: true })
})
