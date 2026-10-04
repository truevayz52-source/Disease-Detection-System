import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { query } from "../db.js"

export const environmentalDataRouter = Router()

// Add environmental data for forecasting
environmentalDataRouter.post("/", requireAuth, requireRole("public_health_analyst", "system_admin"), async (req, res) => {
  const schema = z.object({
    district: z.string(),
    dataType: z.enum(["rainfall", "temperature", "humidity", "water_level"]),
    measurementValue: z.number(),
    unit: z.string(),
    source: z.string(),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid environmental data" })
  
  const { district, dataType, measurementValue, unit, source } = parsed.data
  
  const envId = crypto.randomUUID()
  await query(
    `INSERT INTO environmental_data (env_id, district, data_type, measurement_value, unit, recorded_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [envId, district, dataType, measurementValue, unit, new Date(), source]
  )
  
  res.status(201).json({ envId })
})

// Get environmental data for forecasting
environmentalDataRouter.get("/:district", requireAuth, requireRole("public_health_analyst", "system_admin"), async (req, res) => {
  const dataType = req.query.type as string
  const days = parseInt(req.query.days as string) || "30"
  
  let queryStr = "SELECT * FROM environmental_data WHERE district = ?"
  const params: any[] = [req.params.district]
  
  if (dataType) {
    queryStr += " AND data_type = ?"
    params.push(dataType)
  }
  
  queryStr += ` AND recorded_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY) ORDER BY recorded_at DESC`
  params.push(days)
  
  const data = await query<any[]>(queryStr, params)
  res.json({ items: data })
})
