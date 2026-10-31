/**
 * Feed curated demo cases through the live API — run with:
 *   pnpm --filter server feed:cases
 *
 * Signs in as a system_admin (or FEED_EMAIL/FEED_PASSWORD), then POSTs
 * scripts/data/demo-cases.json to /api/analytics/ingest so each record flows
 * through the real pipeline: validation → patient dedupe → MPDSR workflow →
 * audit → outbreak detection.
 *
 * Env overrides: API_URL (default http://localhost:4001), FEED_EMAIL,
 * FEED_PASSWORD (defaults to the seeded sysadmin/password123).
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

const API = (process.env.API_URL ?? "http://localhost:4001").replace(/\/$/, "")
const EMAIL = process.env.FEED_EMAIL ?? "sysadmin@mohcc.org.zw"
const PASSWORD = process.env.FEED_PASSWORD ?? "password123"

// Optional arg: a JSON file under scripts/data/ (default demo-cases.json).
const file = process.argv[2] ?? "demo-cases.json"
const casesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", file)
const notifications = JSON.parse(readFileSync(casesPath, "utf8")) as unknown[]

async function main() {
  console.log(`[feed] ${notifications.length} case(s) → ${API}`)

  const login = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!login.ok) {
    const body = await login.text()
    console.error(`[feed] login failed (${login.status}): ${body}`)
    process.exit(1)
  }
  const { token } = (await login.json()) as { token: string }
  console.log(`[feed] signed in as ${EMAIL}`)

  const res = await fetch(`${API}/api/analytics/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ notifications }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error(`[feed] ingest failed (${res.status}):`, body)
    process.exit(1)
  }
  const { imported, errors, alertsCreated } = body as { imported: number; errors: string[]; alertsCreated: number }
  console.log(`[feed] imported=${imported} alertsCreated=${alertsCreated}`)
  for (const e of errors ?? []) console.error(`[feed]   ${e}`)
  process.exit(errors?.length ? 1 : 0)
}

main().catch((err) => {
  console.error("[feed]", err?.message ?? err)
  process.exit(1)
})
