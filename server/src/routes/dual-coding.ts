import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"
import { writeAudit } from "../lib/audit.js"

export const dualCodingRouter = Router()

// Search ICD codes with predictive suggestions
dualCodingRouter.get("/search", requireAuth, requireRole("medical_officer", "pathologist", "public_health_analyst", "system_admin"), async (req, res) => {
  const q = req.query.q as string
  const version = req.query.version as string || "ICD-10"
  
  if (!q) return res.status(400).json({ error: "Query parameter required" })
  
  const codes = await query<any[]>(
    `SELECT icd_code, icd_version, description, disease_category, is_notifiable
     FROM icd_codes
     WHERE (icd_code LIKE ? OR description LIKE ?)
     AND icd_version = ?
     ORDER BY description
     LIMIT 20`,
    [`%${q}%`, `%${q}%`, version]
  )
  
  res.json({ items: codes })
})

// Convert ICD-10 to ICD-11 (simplified mapping - in production use WHO API)
dualCodingRouter.post("/convert", requireAuth, requireRole("medical_officer", "pathologist", "public_health_analyst", "system_admin"), async (req, res) => {
  const schema = z.object({
    icd10Code: z.string(),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid ICD code" })
  
  const { icd10Code } = parsed.data
  
  // Simplified mapping - in production integrate with WHO API
  const mapping: Record<string, string> = {
    "A00": "1A01", // Cholera
    "A01": "1A02", // Typhoid
    "A90": "1D10", // Dengue
    "A95": "1D50", // Yellow Fever
    "B50": "1F52", // Malaria
    "O95": "KA55", // Obstetric death
    "P95": "LB60", // Fetal death
  }
  
  const icd11Code = mapping[icd10Code] || null
  
  res.json({ icd10Code, icd11Code, converted: !!icd11Code })
})
