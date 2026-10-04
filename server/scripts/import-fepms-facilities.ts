import { randomUUID } from "node:crypto"
import { getPool, query } from "../src/db.js"

// Coordinates for Zimbabwe provinces
const PROVINCE_COORDINATES: Record<string, { lat: number; lng: number }> = {
  harare: { lat: -17.8292, lng: 31.0522 },
  bulawayo: { lat: -20.15, lng: 28.5833 },
  manicaland: { lat: -18.9707, lng: 32.6709 },
  "mashonaland central": { lat: -17.3, lng: 31.3333 },
  "mashonaland east": { lat: -18.1833, lng: 31.55 },
  "mashonaland west": { lat: -17.3667, lng: 30.2 },
  masvingo: { lat: -20.0636, lng: 30.8277 },
  matabeleland_north: { lat: -18.9317, lng: 27.807 },
  "matabeleland north": { lat: -18.9317, lng: 27.807 },
  matabeleland_south: { lat: -20.9333, lng: 29.0 },
  "matabeleland south": { lat: -20.9333, lng: 29.0 },
  midlands: { lat: -19.45, lng: 29.8167 },
}

// Coordinates for Zimbabwe districts
const DISTRICT_COORDINATES: Record<string, { lat: number; lng: number }> = {
  // Harare
  harare: { lat: -17.8292, lng: 31.0522 },
  chitungwiza: { lat: -18.0128, lng: 31.0756 },
  epworth: { lat: -17.89, lng: 31.1475 },
  ruwa: { lat: -17.8897, lng: 31.2447 },
  // Bulawayo
  "bulawayo central": { lat: -20.15, lng: 28.5833 },
  "bulawayo north": { lat: -20.1167, lng: 28.5833 },
  "bulawayo south": { lat: -20.1833, lng: 28.5833 },
  emakhandeni: { lat: -20.1333, lng: 28.5333 },
  nkulumane: { lat: -20.2, lng: 28.5167 },
  "northern suburbs": { lat: -20.1, lng: 28.6167 },
  // Manicaland
  buhera: { lat: -19.3167, lng: 31.4333 },
  chimanimani: { lat: -19.8, lng: 32.8667 },
  chipinge: { lat: -20.1833, lng: 32.6167 },
  makoni: { lat: -18.5333, lng: 32.1333 },
  mutare: { lat: -18.9707, lng: 32.6709 },
  mutasa: { lat: -18.6167, lng: 32.6833 },
  nyanga: { lat: -18.2167, lng: 32.75 },
  // Mashonaland Central
  bindura: { lat: -17.3, lng: 31.3333 },
  guruve: { lat: -16.6667, lng: 30.7 },
  mazowe: { lat: -17.5167, lng: 30.9833 },
  "mount darwin": { lat: -16.7833, lng: 31.5833 },
  "mt darwin": { lat: -16.7833, lng: 31.5833 },
  muzarabani: { lat: -16.3667, lng: 31.0167 },
  rushinga: { lat: -16.6667, lng: 32.3333 },
  shamva: { lat: -17.1833, lng: 31.5667 },
  // Mashonaland East
  marondera: { lat: -18.1833, lng: 31.55 },
  chikomba: { lat: -19.0, lng: 31.1667 },
  goromonzi: { lat: -17.8167, lng: 31.3833 },
  hwedza: { lat: -18.6167, lng: 31.5667 },
  wedza: { lat: -18.6167, lng: 31.5667 },
  mudzi: { lat: -17.15, lng: 32.5833 },
  murehwa: { lat: -17.65, lng: 31.7833 },
  mutoko: { lat: -17.4, lng: 32.2333 },
  seke: { lat: -18.0167, lng: 31.1333 },
  ump: { lat: -17.0833, lng: 32.0833 },
  // Mashonaland West
  chinhoyi: { lat: -17.3667, lng: 30.2 },
  chegutu: { lat: -18.1333, lng: 30.15 },
  hurungwe: { lat: -16.8167, lng: 29.6833 },
  kariba: { lat: -16.5167, lng: 28.8 },
  makonde: { lat: -17.3667, lng: 30.0 },
  "mhondoro-ngezi": { lat: -18.6, lng: 30.4 },
  sanyati: { lat: -17.95, lng: 29.3 },
  zvimba: { lat: -17.7167, lng: 30.45 },
  // Masvingo
  masvingo: { lat: -20.0636, lng: 30.8277 },
  bikita: { lat: -19.9667, lng: 31.6167 },
  chiredzi: { lat: -21.05, lng: 31.6667 },
  chivi: { lat: -20.3, lng: 30.5 },
  gutu: { lat: -19.65, lng: 31.1667 },
  mwenezi: { lat: -21.4167, lng: 30.7333 },
  zaka: { lat: -20.35, lng: 31.45 },
  // Midlands
  gweru: { lat: -19.45, lng: 29.8167 },
  chirumhanzu: { lat: -19.4167, lng: 30.3667 },
  "gokwe north": { lat: -17.8, lng: 28.9333 },
  "gokwe south": { lat: -18.2167, lng: 28.9333 },
  kwekwe: { lat: -18.9333, lng: 29.8167 },
  mberengwa: { lat: -20.4833, lng: 29.9167 },
  shurugwi: { lat: -19.6667, lng: 30.0 },
  zvishavane: { lat: -20.3333, lng: 30.0667 },
  // Matabeleland North
  lupane: { lat: -18.9317, lng: 27.807 },
  binga: { lat: -17.6167, lng: 27.3333 },
  bubi: { lat: -19.5333, lng: 28.75 },
  hwange: { lat: -18.3667, lng: 26.5 },
  nkayi: { lat: -19.0, lng: 28.9 },
  tsholotsho: { lat: -19.7667, lng: 27.75 },
  umguza: { lat: -20.05, lng: 28.6 },
  // Matabeleland South
  gwanda: { lat: -20.9333, lng: 29.0 },
  beitbridge: { lat: -22.2167, lng: 30.0 },
  bulilima: { lat: -20.05, lng: 27.8167 },
  insiza: { lat: -20.0333, lng: 29.3333 },
  mangwe: { lat: -20.7, lng: 28.05 },
  matobo: { lat: -20.5833, lng: 28.4667 },
  umzingwane: { lat: -20.3, lng: 28.9333 },
}

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
      const distKey = district.toLowerCase()
      const provKey = province.toLowerCase()
      const center = DISTRICT_COORDINATES[distKey] || PROVINCE_COORDINATES[provKey] || { lat: -17.8292, lng: 31.0522 }
      
      // Deterministic spread around district center using row id
      const angle = (Number(row.id) * 137.5 * Math.PI) / 180
      const radius = 0.01 + ((Number(row.id) % 50) / 50) * 0.06 // 1 to 7 km radius
      lat = Number((center.lat + Math.sin(angle) * radius).toFixed(6))
      lng = Number((center.lng + Math.cos(angle) * radius).toFixed(6))
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
