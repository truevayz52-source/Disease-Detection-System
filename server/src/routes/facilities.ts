import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { newId, query } from "../db.js"
import { writeAudit } from "../lib/audit.js"
import { districtCenter, resolveFacilityCoords } from "../lib/zw-geo.js"

export const facilitiesRouter = Router()

facilitiesRouter.get("/geo", requireAuth, async (_req, res) => {
  const [provinces, districts] = await Promise.all([
    query<any[]>("SELECT province_id, province_name FROM provinces ORDER BY province_name"),
    query<any[]>("SELECT district_id, province, district FROM districts ORDER BY province, district"),
  ])
  // Attach a reference centroid per district so clients can auto-fill
  // facility coordinates instead of asking users to type lat/lng.
  const withCoords = districts.map((d) => ({ ...d, ...districtCenter(d.district, d.province) }))
  res.json({ provinces, districts: withCoords })
})

// The facilities table is ~4k rows (~700KB JSON). The hosted DB link is
// bandwidth-throttled, so the full SELECT can take 30s+ — longer than client
// timeouts. Keep a snapshot in-process, refresh it in the background, and
// always serve the last good copy (stale-while-revalidate). Writes trigger
// a refresh but never block requests on the query.
let facilitiesItems: any[] | null = null
let facilitiesLoading: Promise<any[]> | null = null

function refreshFacilities(): Promise<any[]> {
  facilitiesLoading ??= query<any[]>(
    "SELECT facility_id, facility_name, province, district, latitude, longitude, facility_type, created_at FROM facilities ORDER BY facility_name",
  )
    .then((rows) => {
      facilitiesItems = rows
      facilitiesLoading = null
      return rows
    })
    .catch((err) => {
      facilitiesLoading = null
      throw err
    })
  return facilitiesLoading
}

// Warm at startup, then refresh every 60s — facilities change rarely.
setInterval(() => { void refreshFacilities().catch(() => {}) }, 60_000).unref()
void refreshFacilities().catch(() => {})

facilitiesRouter.get("/", requireAuth, async (req, res) => {
  const items = facilitiesItems ?? (await refreshFacilities())
  // Optional filters — applied to the snapshot, so search costs nothing.
  const q = String(req.query.q ?? "").trim().toLowerCase()
  const province = String(req.query.province ?? "").trim()
  const district = String(req.query.district ?? "").trim()
  const type = String(req.query.type ?? "").trim()
  const out = items.filter(
    (f) =>
      (!q ||
        [f.facility_name, f.facility_code, f.district, f.province].some((v) =>
          String(v ?? "").toLowerCase().includes(q),
        )) &&
      (!province || f.province === province) &&
      (!district || f.district === district) &&
      (!type || f.facility_type === type),
  )
  res.json({ items: out })
})

const facilitySchema = z.object({
  facilityName: z.string().min(2),
  province: z.string().min(2),
  district: z.string().min(2),
  // Optional — auto-resolved from the device GPS on the client, or from the
  // district centroid server-side when absent. Users never type coordinates.
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  facilityType: z.string().default("district_hospital"),
})

facilitiesRouter.post("/", requireAuth, requireRole("system_admin"), async (req, res) => {
  const parsed = facilitySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid facility data", issues: parsed.error.issues })

  const id = newId("fac")
  const d = parsed.data
  const coords =
    d.latitude != null && d.longitude != null
      ? { lat: d.latitude, lng: d.longitude }
      : resolveFacilityCoords(d.district, d.province, d.facilityName)
  await query(
    "INSERT INTO facilities (facility_id, facility_name, province, district, latitude, longitude, facility_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, d.facilityName, d.province, d.district, coords.lat, coords.lng, d.facilityType],
  )
  await writeAudit(req, { action: "create_facility", entityType: "facilities", entityId: id, details: d })
  void refreshFacilities().catch(() => {})
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
  void refreshFacilities().catch(() => {})
  res.json({ ok: true })
})
