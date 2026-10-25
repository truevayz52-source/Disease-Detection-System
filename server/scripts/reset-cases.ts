import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getPool, query } from "../src/db.js"
import { writeAudit } from "../src/lib/audit.js"

/**
 * Wipes all transactional case data so the system starts empty for manual
 * input. Reference data (facilities, provinces, districts, icd_codes, users,
 * thresholds, settings, playbooks) is preserved — TRUNCATE ... CASCADE only
 * follows FKs into tables that *reference* the truncated ones.
 *
 * Usage: pnpm --filter server reset:cases --confirm
 */

const TRANSACTIONAL_TABLES = [
  "notification_submissions",
  "offline_sync_queue",
  "medical_certifications",
  "ai_pathology_analysis",
  "image_annotations",
  "specimen_tracking",
  "peer_reviews",
  "decode_panels",
  "causal_chain_cod",
  "verbal_autopsies",
  "tele_pathology_images",
  "autopsy_reports",
  "mpdsr_actions",
  "mpdsr_workflows",
  "case_investigations",
  "entity_comments",
  "evidence_files",
  "death_notifications",
  "patients",
  "outbreak_alerts",
  "community_reports",
  "health_signals",
  "signal_workflow_events",
  "media_mentions",
  "feedback_items",
  "health_activities",
  "campaigns",
  "iec_materials",
  "trainings",
  "calendar_events",
  "documents",
  "communications_log",
  "signal_playbook_links",
  "voice_transcriptions",
  "gps_tracking",
  "cross_border_cases",
  "crvs_bridge",
  "resource_forecasts",
  "anonymization_logs",
  "report_runs",
  "user_notifications",
  "environmental_data",
  "audit_log",
  "blockchain_audit",
]

if (!process.argv.includes("--confirm")) {
  console.error("Destructive: wipes every case/notification/alert/audit row.")
  console.error("Reference data (facilities, provinces, districts, ICD codes, users) is kept.")
  console.error("Re-run with --confirm to proceed.")
  process.exit(1)
}

const existing = await query<any[]>(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
)
const present = TRANSACTIONAL_TABLES.filter((t) => existing.some((r) => r.table_name === t))
const missing = TRANSACTIONAL_TABLES.filter((t) => !present.includes(t))
if (missing.length) console.log(`Skipping ${missing.length} absent table(s): ${missing.join(", ")}`)

const before = await query<any[]>(
  "SELECT COUNT(*) AS c FROM death_notifications",
)
console.log(`death_notifications before: ${Number(before[0]?.c ?? 0)}`)

await query(
  `TRUNCATE ${present.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`,
)

// Fresh audit row so the wiped chain records the reset itself.
await writeAudit(null, {
  action: "system_data_reset",
  entityType: "system",
  details: { tables: present.length, tool: "reset:cases" },
})

// Orphaned specimen uploads owned by wiped rows.
const uploadsDir = fileURLToPath(new URL("../uploads/", import.meta.url))
let removed = 0
try {
  for (const entry of await fs.readdir(uploadsDir)) {
    if (entry === ".gitkeep" || entry.startsWith(".")) continue
    await fs.rm(path.join(uploadsDir, entry), { recursive: true, force: true })
    removed += 1
  }
} catch {
  /* uploads dir may not exist on a fresh clone */
}

const after = await query<any[]>(
  "SELECT COUNT(*) AS c FROM death_notifications",
)
console.log(`Truncated ${present.length} table(s); cleared ${removed} upload file(s).`)
console.log(`death_notifications after: ${Number(after[0]?.c ?? 0)}`)
await getPool().end()
