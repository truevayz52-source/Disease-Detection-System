/**
 * Repair facilities whose `district` column holds a province name (or 'Central'/'Other' junk)
 * left by the FEPMS import fallback. Each bad row is reassigned to the real district of the
 * nearest reference facility (BIIM facilities.json) within its province; rows with a bogus
 * province ('National'/'Other') inherit the matched district's province too.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { query } from "../src/db"

interface Ref { province: string; district: string; lat: number; lng: number }
interface Fac { facility_id: string; facility_name: string; province: string; district: string; latitude: number; longitude: number }

const VALID_PROVINCES = new Set([
  "Bulawayo", "Harare", "Manicaland", "Mashonaland Central", "Mashonaland East",
  "Mashonaland West", "Masvingo", "Matabeleland North", "Matabeleland South", "Midlands",
])

function dist2(aLat: number, aLng: number, b: Ref) {
  const dy = aLat - b.lat, dx = (aLng - b.lng) * Math.cos((aLat * Math.PI) / 180)
  return dy * dy + dx * dx
}

async function main() {
  const dataDir = fileURLToPath(new URL("./data/", import.meta.url))
  const refs = (JSON.parse(await fs.readFile(path.join(dataDir, "facilities.json"), "utf8")) as any[])
    .filter((r) => VALID_PROVINCES.has(r.province) && r.district && r.lat && r.lng)
    .map((r) => ({ province: r.province, district: r.district, lat: r.lat, lng: r.lng }))

  const bad = await query<Fac[]>(
    `SELECT f.facility_id, f.facility_name, f.province, f.district, f.latitude, f.longitude
     FROM facilities f
     LEFT JOIN districts d ON d.district = f.district AND d.province = f.province
     WHERE d.district_id IS NULL`,
  )
  console.log(`[fix-districts] ${bad.length} facilities with invalid district`)

  let fixed = 0, skipped = 0
  const byNewDistrict: Record<string, number> = {}
  for (const f of bad) {
    const pool = VALID_PROVINCES.has(f.province) ? refs.filter((r) => r.province === f.province) : refs
    if (!pool.length || f.latitude == null || f.longitude == null) { skipped++; continue }
    let best = pool[0], bestD = dist2(f.latitude, f.longitude, best)
    for (let i = 1; i < pool.length; i++) {
      const d = dist2(f.latitude, f.longitude, pool[i])
      if (d < bestD) { bestD = d; best = pool[i] }
    }
    await query("UPDATE facilities SET province = ?, district = ? WHERE facility_id = ?", [best.province, best.district, f.facility_id])
    byNewDistrict[`${best.province}|${best.district}`] = (byNewDistrict[`${best.province}|${best.district}`] ?? 0) + 1
    fixed++
  }
  console.log(`[fix-districts] fixed=${fixed} skipped=${skipped}`)
  console.log("[fix-districts] reassignment breakdown:", byNewDistrict)
  const [remaining] = await query<any[]>(
    `SELECT COUNT(*) t FROM facilities f LEFT JOIN districts d ON d.district = f.district AND d.province = f.province WHERE d.district_id IS NULL`,
  )
  console.log(`[fix-districts] remaining invalid: ${remaining.t}`)
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
