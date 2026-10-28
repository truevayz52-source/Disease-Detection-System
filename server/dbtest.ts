import { query, pool } from "./src/db.js"
// warm sequential SELECT 1s — measures per-round-trip latency to Supabase
for (let i = 0; i < 5; i++) {
  const t = Date.now()
  await query("SELECT 1")
  console.log(`q${i}: ${Date.now() - t}ms`)
}
// check for currently-held advisory locks (the stuck-lock problem from before)
const locks = await query<any>(
  "SELECT l.pid, a.state, left(a.query,70) q FROM pg_locks l LEFT JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory'",
)
console.log("advisory locks:", JSON.stringify(locks))
// slow queries in flight
const slow = await query<any>(
  "SELECT pid, state, now()-query_start AS age, left(query,80) q FROM pg_stat_activity WHERE state='active' AND query NOT LIKE '%pg_stat_activity%' ORDER BY query_start LIMIT 10",
)
console.log("active queries:", JSON.stringify(slow))
process.exit(0)
