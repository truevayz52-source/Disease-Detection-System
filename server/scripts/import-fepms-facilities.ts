import { randomUUID } from "node:crypto"
import { getPool, query } from "../src/db.js"
import {
  DISTRICT_COORDINATES,
  PROVINCE_COORDINATES,
  resolveFacilityCoords,
} from "../src/lib/zw-geo.js"

function toTitleCase(str: string): string {
  if (!str) return ""
  return str
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

function normalizeType(rawType: string): string {
  if (!rawType) return "clinic"
  const clean = rawType.toLowerCase().trim()
  if (clean.includes("central hospital")) return "central_hospital"
  if (clean.includes("provincial hospital")) return "provincial_hospital"
  if (clean.includes("district hospital")) return "district_hospital"
  if (clean.includes("mission hospital")) return "mission_hospital"
  if (clean.includes("general hospital")) return "general_hospital"
  if (clean.includes("private hospital")) return "private_hospital"
  if (clean.includes("rural health")) return "rural_health_clinic"
  if (clean.includes("specialist")) return "specialist_clinic"
  if (clean.includes("laboratory")) return "laboratory"
  if (clean.includes("head office")) return "head_office"
  if (clean.includes("provincial medical directorate")) return "provincial_office"
  if (clean.includes("district medical directorate")) return "district_office"
  if (clean.includes("administrative")) return "administrative_office"
  if (clean.includes("clinic")) return "clinic"
  return clean.replace(/\s+/g, "_")
}

async function main() {
  console.log("[import-facilities] Starting facility import from fepms_db to dds_db...")

  // 1. Ensure facility_code column exists in dds_db.facilities
  try {
    await query(`
      ALTER TABLE dds_db.facilities 
      ADD COLUMN IF NOT EXISTS facility_code VARCHAR(30) NULL AFTER facility_name
    `)
    console.log("[import-facilities] verified facility_code column in dds_db.facilities")
  } catch (err: any) {
    console.log("[import-facilities] note on facility_code column:", err.message)
  }

  // 2. Fetch existing facilities in dds_db
  const existingRows = await query<any[]>("SELECT facility_id, facility_name, facility_code FROM dds_db.facilities")
  const existingByName = new Map<string, string>()
  const existingByCode = new Map<string, string>()
  for (const row of existingRows) {
    existingByName.set(row.facility_name.toLowerCase().trim(), row.facility_id)
    if (row.facility_code) {
      existingByCode.set(row.facility_code.toUpperCase().trim(), row.facility_id)
    }
  }
  console.log(`[import-facilities] found ${existingRows.length} existing facilities in dds_db.`)

  // 3. Fetch all facilities from fepms_db
  const fepmsRows = await query<any[]>(`
    SELECT 
      id,
      facility_name,
      facility_code,
      facility_type,
      province_name,
      district_name,
      latitude,
      longitude
    FROM fepms_db.vw_physical_facilities
    ORDER BY id ASC
  `)
  console.log(`[import-facilities] fetched ${fepmsRows.length} facilities from fepms_db.vw_physical_facilities.`)

  let inserted = 0
  let updated = 0
  let skipped = 0

  for (const row of fepmsRows) {
    const rawName = row.facility_name?.trim() || `Facility ${row.facility_code}`
    const code = row.facility_code?.trim().toUpperCase() || null
    let province = toTitleCase(row.province_name?.trim() || "")
    let district = toTitleCase(row.district_name?.trim() || "")

    // Inference for missing province/district
    if (!province) {
      const lowerName = rawName.toLowerCase()
      for (const p of Object.keys(PROVINCE_COORDINATES)) {
        if (lowerName.includes(p)) {
          province = toTitleCase(p)
          break
        }
      }
      if (!province) {
        for (const [d, coords] of Object.entries(DISTRICT_COORDINATES)) {
          if (lowerName.includes(d)) {
            district = toTitleCase(d)
            break
          }
        }
      }
      if (!province) province = district ? "Other" : "National"
    }

    if (!district) {
      district = province !== "National" && province !== "Other" ? province : "Central"
    }

    // Determine coordinates
    let lat: number | null = row.latitude ? Number(row.latitude) : null
    let lng: number | null = row.longitude ? Number(row.longitude) : null

    if (!lat || !lng || Number.isNaN(lat) || Number.isNaN(lng)) {
      // Deterministic spread around district center using row id
      const resolved = resolveFacilityCoords(district, province, String(row.id))
      lat = resolved.lat
      lng = resolved.lng
    }

    const facilityType = normalizeType(row.facility_type)

    // Check if facility already exists by code or exact name
    const existingId = (code && existingByCode.get(code)) || existingByName.get(rawName.toLowerCase())

    if (existingId) {
      // Update existing record
      await query(
        `UPDATE dds_db.facilities 
         SET facility_code = COALESCE(?, facility_code),
             facility_name = ?,
             province = ?,
             district = ?,
             latitude = ?,
             longitude = ?,
             facility_type = ?
         WHERE facility_id = ?`,
        [code, rawName, province, district, lat, lng, facilityType, existingId]
      )
      updated++
    } else {
      // Insert new facility
      const newFacilityId = randomUUID()
      await query(
        `INSERT INTO dds_db.facilities 
         (facility_id, facility_name, facility_code, province, district, latitude, longitude, facility_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [newFacilityId, rawName, code, province, district, lat, lng, facilityType]
      )
      if (code) existingByCode.set(code, newFacilityId)
      existingByName.set(rawName.toLowerCase(), newFacilityId)
      inserted++
    }
  }

  console.log(`[import-facilities] Import complete!`)
  console.log(`[import-facilities] Summary: ${inserted} inserted, ${updated} updated, total processed: ${fepmsRows.length}`)

  const totalCount = await query<any[]>("SELECT count(*) as count FROM dds_db.facilities")
  console.log(`[import-facilities] Total facilities in dds_db now: ${totalCount[0].count}`)

  // Sample check
  const samples = await query<any[]>(`
    SELECT facility_id, facility_name, facility_code, province, district, facility_type, latitude, longitude 
    FROM dds_db.facilities 
    ORDER BY created_at DESC 
    LIMIT 5
  `)
  console.log("[import-facilities] Sample imported facilities:", samples)

  await getPool().end()
  process.exit(0)
}

main().catch((err) => {
  console.error("[import-facilities] Error:", err)
  process.exit(1)
})
