import { Router } from "../lib/router.js"
import { requireAuth } from "../auth/middleware.js"
import { query } from "../db.js"
import { z } from "zod"
import { searchWho } from "../lib/integrations.js"

export const icdRouter = Router()
icdRouter.get("/who", requireAuth, async (req, res) => {
  const q = z.string().trim().min(2).max(100).parse(req.query.q)
  res.json({ items: await searchWho(q) })
})

// Autocomplete endpoint — target latency <1s (Ch 5.9 KPI).
icdRouter.get("/", requireAuth, async (req, res) => {
  const q = String(req.query.q ?? "").trim()
  if (!q) {
    const rows = await query<any[]>(
      "SELECT icd_code, icd_version, description, disease_category, is_notifiable FROM icd_codes ORDER BY icd_code LIMIT 50",
    )
    return res.json({ items: rows })
  }
  const like = `%${q}%`
  const rows = await query<any[]>(
    `SELECT icd_code, icd_version, description, disease_category, is_notifiable
     FROM icd_codes
     WHERE icd_code LIKE ? OR description LIKE ? OR disease_category LIKE ?
     ORDER BY icd_code LIMIT 20`,
    [like, like, like],
  )
  res.json({ items: rows })
})
