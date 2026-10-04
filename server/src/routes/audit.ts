import { Router } from "../lib/router.js"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"
import { verifyAuditChain } from "../lib/audit.js"

export const auditRouter = Router()

const VIEWERS = requireRole("public_health_analyst", "system_admin")

auditRouter.get("/", requireAuth, VIEWERS, async (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1))
  const size = Math.min(100, Math.max(10, Number(req.query.size ?? 25)))
  const where: string[] = []
  const params: any[] = []
  if (req.query.action) {
    where.push("a.action = ?")
    params.push(String(req.query.action))
  }
  if (req.query.entityType) {
    where.push("a.entity_type = ?")
    params.push(String(req.query.entityType))
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : ""
  const rows = await query<any[]>(
    `SELECT a.audit_id, a.action, a.entity_type, a.entity_id, a.ip_address, a.details,
            a.record_hash, a.previous_hash, a.created_at, u.full_name AS user_name
     FROM audit_log a LEFT JOIN users u ON u.user_id = a.user_id
     ${whereSql}
     ORDER BY a.created_at DESC, a.audit_id DESC
     LIMIT ? OFFSET ?`,
    [...params, size, (page - 1) * size],
  )
  const [countRow] = await query<any[]>(`SELECT COUNT(*) AS c FROM audit_log a ${whereSql}`, params)
  res.json({ items: rows, page, size, total: Number(countRow?.c ?? 0) })
})

auditRouter.get("/verify", requireAuth, VIEWERS, async (_req, res) => {
  res.json(await verifyAuditChain())
})
