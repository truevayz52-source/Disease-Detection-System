import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { newId, query } from "../db.js"

export const patientsRouter = Router()

patientsRouter.get("/", requireAuth, requireRole("public_health_analyst", "pathologist", "system_admin"), async (req, res) => {
  const q = String(req.query.q ?? "").trim()
  const like = `%${q}%`
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50))
  const whereSql = q ? "WHERE full_name LIKE ? OR national_id LIKE ?" : ""
  const params = q ? [like, like] : []
  const rows = await query<any[]>(
    `SELECT patient_id, national_id, full_name, age, gender, residential_address, latitude, longitude, created_at
     FROM patients ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  const [countRow] = await query<any[]>(`SELECT COUNT(*) AS total FROM patients ${whereSql}`, params)
  res.json({ items: rows, total: Number(countRow?.total ?? 0), page, pageSize })
})
