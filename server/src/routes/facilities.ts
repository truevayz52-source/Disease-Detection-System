import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { newId, query } from "../db.js"
import { writeAudit } from "../lib/audit.js"

export const facilitiesRouter = Router()

facilitiesRouter.get("/geo", requireAuth, async (_req, res) => {
  const [provinces, districts] = await Promise.all([
    query<any[]>("SELECT province_id, province_name FROM provinces ORDER BY province_name"),
    query<any[]>("SELECT district_id, province, district FROM districts ORDER BY province, district"),
  ])
  res.json({ provinces, districts })
})

facilitiesRouter.get("/", requireAuth, async (_req, res) => {
  const rows = await query<any[]>(
    "SELECT facility_id, facility_name, province, district, latitude, longitude, facility_type, created_at FROM facilities ORDER BY facility_name",
  )
  res.json({ items: rows })
})

const facilitySchema = z.object({
  facilityName: z.string().min(2),
  province: z.string().min(2),
  district: z.string().min(2),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  facilityType: z.string().default("district_hospital"),
})

facilitiesRouter.post("/", requireAuth, requireRole("system_admin"), async (req, res) => {
  const parsed = facilitySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid facility data", issues: parsed.error.issues })

  const id = newId("fac")
  const d = parsed.data
  await query(
    "INSERT INTO facilities (facility_id, facility_name, province, district, latitude, longitude, facility_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, d.facilityName, d.province, d.district, d.latitude, d.longitude, d.facilityType],
  )
  await writeAudit(req, { action: "create_facility", entityType: "facilities", entityId: id, details: d })
  res.status(201).json({ facilityId: id })
})

facilitiesRouter.patch("/:id", requireAuth, requireRole("system_admin"), async (req, res) => {
  const parsed = facilitySchema.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid facility data" })

  const d = parsed.data
  const sets: string[] = []
  const params: any[] = []
  const map: Record<string, string> = {
    facilityName: "facility_name",
    province: "province",
    district: "district",
    latitude: "latitude",
    longitude: "longitude",
    facilityType: "facility_type",
  }
  for (const [k, col] of Object.entries(map)) {
    const v = (d as any)[k]
    if (v !== undefined) {
      sets.push(`${col} = ?`)
      params.push(v)
    }
  }
  if (!sets.length) return res.status(400).json({ error: "Nothing to update" })

  params.push(req.params.id)
  const result = await query<any>(`UPDATE facilities SET ${sets.join(", ")} WHERE facility_id = ?`, params)
  if (!result.affectedRows) return res.status(404).json({ error: "Facility not found" })
  await writeAudit(req, { action: "update_facility", entityType: "facilities", entityId: req.params.id, details: d })
  res.json({ ok: true })
})
