/**
 * Import BIIMZim reference geodata into dds_db:
 *  - 10 provinces (National excluded — it is a scope level, not a province)
 *  - districts.json  → districts table
 *  - facilities.json → merge rows missing from facilities (dedup name+district)
 *  - starter response playbooks
 * Run: pnpm --filter server exec tsx scripts/import-biim-geodata.ts
 */
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { newId, query, getPool } from "../src/db.js"

const dataDir = fileURLToPath(new URL("./data/", import.meta.url))

const PROVINCES = [
  "Harare", "Bulawayo", "Manicaland", "Mashonaland Central", "Mashonaland East",
  "Mashonaland West", "Masvingo", "Matabeleland North", "Matabeleland South", "Midlands",
]

const PLAYBOOKS = [
  {
    name: "Suspected cholera outbreak",
    signalType: "outbreak_report",
    diseaseCategory: "Cholera/AWD",
    description: "Standard MOHCC response for clustered acute watery diarrhoea reports.",
    steps: [
      "Verify signal with district rapid response team within 24h",
      "Collect stool/rectal swab specimens and dispatch to nearest lab",
      "Activate case definition and line-list suspected cases",
      "Assess water, sanitation and hygiene (WASH) conditions in affected area",
      "Issue community alert and safe-water advisory",
      "Report to provincial epidemiologist and log outcomes",
    ],
  },
  {
    name: "Unexplained deaths cluster",
    signalType: "community_alert",
    diseaseCategory: "Unexplained mortality",
    description: "Escalation path for multiple community deaths with unknown cause.",
    steps: [
      "Cross-check reported deaths against death_notifications registry",
      "Dispatch medical officer for verbal autopsy where burial not yet done",
      "Order post-mortem examination for medico-legal cases",
      "Review spatial clustering on the outbreak map",
      "Brief provincial health director and open case investigation",
    ],
  },
  {
    name: "Maternal death (MPDSR) notification",
    signalType: "community_alert",
    diseaseCategory: "Maternal mortality",
    description: "Mandatory maternal death surveillance and response workflow.",
    steps: [
      "Log death notification and flag for MPDSR tracker",
      "Notify facility MPDSR focal person within 24h",
      "Schedule maternal death review panel",
      "Document cause-of-death chain (causal_chain_cod)",
      "Capture corrective actions and close feedback loop",
    ],
  },
  {
    name: "Media misinformation about mortality data",
    signalType: "misinformation",
    diseaseCategory: null,
    description: "Response to false claims circulating about deaths or cause-of-death data.",
    steps: [
      "Capture the media mention and classify reach/severity",
      "Verify against registry data with the analytics team",
      "Draft a factual holding statement via communications",
      "Brief spokesperson; log the response in communications_log",
      "Monitor for recurrence and mark signal resolved when corrected",
    ],
  },
]

async function main() {
  // Provinces — 10 only, National excluded.
  for (const name of PROVINCES) {
    const exists = await query<any[]>("SELECT province_id FROM provinces WHERE province_name = ?", [name])
    if (!exists.length) await query("INSERT INTO provinces (province_id, province_name) VALUES (?, ?)", [newId("prv"), name])
  }
  const [{ c: pc }] = await query<any[]>("SELECT COUNT(*) c FROM provinces")
  console.log(`[biim-import] provinces: ${pc}`)

  // Districts
  // The BIIM source has dirty districts (wrong province, legacy spellings). Normalize before insert.
  const DISTRICT_FIX: Record<string, string> = {
    "Manicaland|Bulawayo": "Bulawayo",
    "Manicaland|Bulilima": "Matabeleland South",
    "Matabeleland North|Umzingwane": "Matabeleland South",
  }
  const DISTRICT_RENAME: Record<string, string> = {
    "Matabeleland South|Bulilimamangwe": "Bulilima",
    "Matabeleland South|Bulilimamangwe North": "Bulilima",
    "Matabeleland South|Bulilimamangwe South": "Bulilima",
    "Mashonaland East|Ump": "UMP",
  }
  const EXTRA_DISTRICTS: [string, string][] = [
    ["Harare", "Epworth"],
    ["Harare", "Ruwa"],
    ["Bulawayo", "Bulawayo Central"],
    ["Bulawayo", "Bulawayo North"],
    ["Bulawayo", "Bulawayo South"],
    ["Bulawayo", "Emakhandeni"],
    ["Bulawayo", "Nkulumane"],
    ["Bulawayo", "Northern Suburbs"],
    ["Mashonaland Central", "Muzarabani"],
    ["Mashonaland West", "Mhondoro-Ngezi"],
    ["Mashonaland West", "Sanyati"],
  ]
  const rawDistricts = JSON.parse(await fs.readFile(path.join(dataDir, "districts.json"), "utf8")) as { province: string; district: string }[]
  const districts = [...rawDistricts, ...EXTRA_DISTRICTS.map(([province, district]) => ({ province, district }))]
    .map((d) => ({ province: DISTRICT_FIX[`${d.province}|${d.district}`] ?? d.province, district: DISTRICT_RENAME[`${d.province}|${d.district}`] ?? d.district }))
  const seen = new Set<string>()
  const districtsDeduped = districts.filter((d) => {
    const k = `${d.province}|${d.district}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  let dAdded = 0
  for (const d of districtsDeduped) {
    const exists = await query<any[]>("SELECT district_id FROM districts WHERE province = ? AND district = ?", [d.province, d.district])
    if (!exists.length) {
      await query("INSERT INTO districts (district_id, province, district) VALUES (?, ?, ?)", [newId("dst"), d.province, d.district])
      dAdded++
    }
  }
  console.log(`[biim-import] districts: +${dAdded} (of ${districts.length})`)

  // Facilities merge — dedup on lower(name)+district and on source_id.
  const facilities = JSON.parse(await fs.readFile(path.join(dataDir, "facilities.json"), "utf8")) as {
    sourceId: string; name: string; province: string; district: string; lat: number; lng: number; type: string
  }[]
  const existing = await query<any[]>("SELECT facility_name, district, source_id FROM facilities")
  const byNameDistrict = new Set(existing.map(r => `${r.facility_name.toLowerCase().trim()}|${(r.district ?? "").toLowerCase().trim()}`))
  const bySource = new Set(existing.filter(r => r.source_id).map(r => r.source_id))
  let fAdded = 0, fSkipped = 0
  for (const f of facilities) {
    const key = `${f.name.toLowerCase().trim()}|${(f.district ?? "").toLowerCase().trim()}`
    if (bySource.has(f.sourceId) || byNameDistrict.has(key)) { fSkipped++; continue }
    await query(
      "INSERT INTO facilities (facility_id, facility_name, province, district, latitude, longitude, facility_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [newId("fac"), f.name, f.province, f.district, f.lat, f.lng, (f.type || "health_facility").toLowerCase().replace(/\s+/g, "_"), f.sourceId],
    )
    fAdded++
  }
  console.log(`[biim-import] facilities: +${fAdded} inserted, ${fSkipped} already present`)

  // Starter playbooks
  for (const pb of PLAYBOOKS) {
    const exists = await query<any[]>("SELECT playbook_id FROM response_playbooks WHERE name = ?", [pb.name])
    if (!exists.length) {
      await query(
        "INSERT INTO response_playbooks (playbook_id, name, description, signal_type, disease_category, steps) VALUES (?, ?, ?, ?, ?, ?)",
        [newId("pbk"), pb.name, pb.description, pb.signalType, pb.diseaseCategory, JSON.stringify(pb.steps)],
      )
    }
  }
  console.log("[biim-import] playbooks seeded")
}

main()
  .catch((err) => { console.error("[biim-import] failed:", err); process.exitCode = 1 })
  .finally(() => getPool().end())
