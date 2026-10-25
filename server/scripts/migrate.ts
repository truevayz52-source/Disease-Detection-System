import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getPool, acquireAdvisoryLock, releaseAdvisoryLock } from "../src/db.js"

// Applies supabase/migrations/*.sql in order, tracked in public.schema_migrations.
// `supabase db push` is the primary path; this script exists so a plain Node
// deployment can migrate without the Supabase CLI.
const directory = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url))
const conn = await getPool().getConnection()
try {
  if (!await acquireAdvisoryLock(conn, "dds_schema_migration", 30)) throw new Error("Another migration is running")
  try {
    await conn.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())")
    const [appliedRows] = await conn.query<any[]>("SELECT version FROM schema_migrations")
    const applied = new Set<string>(appliedRows.map((r: any) => r.version))
    for (const filename of (await fs.readdir(directory)).filter(f => /^\d+.*\.sql$/.test(f)).sort()) {
      const version = filename.replace(/\.sql$/, "")
      if (applied.has(version)) continue
      const sql = await fs.readFile(path.join(directory, filename), "utf8")
      await conn.beginTransaction()
      try {
        await conn.query(sql) // pg simple protocol runs all statements in the file
        await conn.query("INSERT INTO schema_migrations (version) VALUES (?)", [version])
        await conn.commit()
        console.log(`Applied ${filename}`)
      } catch (err) {
        await conn.rollback()
        throw err
      }
    }
  } finally {
    await releaseAdvisoryLock(conn, "dds_schema_migration")
  }
} finally {
  conn.release()
  await getPool().end()
}
