import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"
import { config } from "../src/config.js"

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))))

// Tolerates errors from re-applying statements that already landed
// (duplicate_column, duplicate_table, duplicate_object).
const ignored = new Set(["42701", "42P07", "42710"])

function stripComments(sql: string) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
}

function splitStatements(sql: string) {
  return stripComments(sql)
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^\s*$/.test(s))
}

async function runFile(client: pg.Client, file: string) {
  const sql = await fs.readFile(file, "utf8")
  const statements = splitStatements(sql)
  for (const stmt of statements) {
    try {
      await client.query(stmt)
      console.log(`  applied: ${stmt.split(/\s+/).slice(0, 3).join(" ")}`)
    } catch (err: any) {
      if (ignored.has(err.code)) {
        console.log(`  skipped: ${err.message}`)
      } else {
        throw err
      }
    }
  }
}

async function main() {
  const client = new pg.Client({
    connectionString: config.databaseUrl,
    ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  })
  await client.connect()

  try {
    console.log("Applying migrations...")
    await runFile(client, path.join(root, "supabase", "migrations", "20251018000007_case_workflow.sql"))
    await runFile(client, path.join(root, "supabase", "migrations", "20251018000008_mpdsr_review_stages.sql"))
    console.log("Migrations applied.")
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error("Migration failed:", e.message)
  process.exit(1)
})
