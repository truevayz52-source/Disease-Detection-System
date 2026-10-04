import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getPool, query } from "../src/db.js"

const directory = fileURLToPath(new URL("../../db/", import.meta.url))
try {
  const [lock] = await query<any[]>("SELECT GET_LOCK('dds_schema_migration', 30) AS acquired")
  if (!lock?.acquired) throw new Error("Another migration is running")
  for (const filename of (await fs.readdir(directory)).filter(f => /^\d+.*\.sql$/.test(f)).sort()) {
    const sql = (await fs.readFile(path.join(directory, filename), "utf8")).replace(/^--.*$/gm, "")
    for (const statement of sql.split(";").map(s => s.trim()).filter(Boolean)) {
      // Recover safely from a partially applied migration without ignoring other errors.
      const column = statement.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+)/i)
      const index = statement.match(/^ALTER TABLE (\w+) ADD (?:UNIQUE )?INDEX (\w+)/i)
      if (column) {
        const rows = await query<any[]>("SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?", column.slice(1))
        if (rows.length) continue
      }
      if (index) {
        const rows = await query<any[]>("SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?", index.slice(1))
        if (rows.length) continue
      }
      await query(statement)
    }
    console.log(`Applied ${filename}`)
  }
} finally {
  await getPool().end()
}
