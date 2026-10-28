import pg from "pg"
import { config } from "./config.js"

// ---------------------------------------------------------------------------
// node-postgres (pg) behind a mysql2-compatible facade.
//
// The codebase was written against mysql2 conventions:
//   - '?' placeholders  -> translated to $1..$n by translate()
//   - `const [rows] = await pool.query(sql)` destructuring
//   - pool.getConnection() with beginTransaction/commit/rollback/release
//   - write queries resolve to a header object with .affectedRows
// Keeping that shape means only true SQL-dialect differences needed edits.
// Supabase: point DATABASE_URL at the Supavisor pooled string (port 6543).
// ---------------------------------------------------------------------------

const { Pool, types } = pg

// Match mysql2's JS output types: DECIMAL -> number, BIGINT -> number,
// DATE -> Date. (pg returns all three as strings by default.)
types.setTypeParser(20, (v) => (v === null ? null : Number(v)))
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)))
types.setTypeParser(1082, (v) => (v === null ? null : new Date(`${v}T00:00:00Z`)))

/** Convert '?' placeholders to '$n', skipping string literals, quoted
 *  identifiers, dollar-quoted blocks and SQL comments. */
function translate(sql: string): string {
  let out = ""
  let n = 0
  let i = 0
  while (i < sql.length) {
    const c = sql[i]
    if (c === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "\\") j += 2
        else if (sql[j] === "'" && sql[j + 1] === "'") j += 2
        else if (sql[j] === "'") { j += 1; break }
        else j += 1
      }
      out += sql.slice(i, j); i = j; continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === '"' && sql[j + 1] === '"') j += 2
        else if (sql[j] === '"') { j += 1; break }
        else j += 1
      }
      out += sql.slice(i, j); i = j; continue
    }
    if (c === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (m) {
        const tag = m[0]
        const end = sql.indexOf(tag, i + tag.length)
        const j = end === -1 ? sql.length : end + tag.length
        out += sql.slice(i, j); i = j; continue
      }
    }
    if (c === "-" && sql[i + 1] === "-") {
      const j = sql.indexOf("\n", i)
      const end = j === -1 ? sql.length : j
      out += sql.slice(i, end); i = end; continue
    }
    if (c === "/" && sql[i + 1] === "*") {
      const j = sql.indexOf("*/", i + 2)
      const end = j === -1 ? sql.length : j + 2
      out += sql.slice(i, end); i = end; continue
    }
    if (c === "?") { n += 1; out += `$${n}`; i += 1; continue }
    out += c; i += 1
  }
  return out
}

function pack(res: pg.QueryResult): any {
  if (res.command === "SELECT" || res.command === "SHOW" || res.command === "WITH") return res.rows
  return { affectedRows: res.rowCount ?? 0, insertId: null }
}

const realPool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 60000,
  keepAlive: true,
  // Fail fast when the pool is exhausted instead of queueing a request
  // forever — a stuck backend would otherwise hang HTTP calls silently.
  connectionTimeoutMillis: 10000,
  // Session time zone pinned in the startup packet so now()/CURRENT_DATE in
  // the detection queries don't drift with the DB server's TZ. Replaces a
  // per-connect SET query — client.query() inside the pool 'connect' event
  // trips pg's "already executing a query" deprecation warning.
  options: `-c timezone=${config.dbTimeZone}`,
})

// Idle pooled clients dropped by the network/Supavisor emit 'error' on the
// pool — without a listener the process crashes on ECONNRESET. pg removes
// the dead client itself; active queries still reject normally.
realPool.on("error", (err) => {
  console.error("[db] idle client dropped:", err.message)
})

/** A mysql2-PoolConnection-shaped wrapper around a pg.PoolClient. */
export class PgConnection {
  constructor(private readonly client: pg.PoolClient) {}
  async query<T = any>(sql: string, params: any[] = []): Promise<[T, any]> {
    const res = await this.client.query(translate(sql), params)
    return [pack(res) as T, res.fields]
  }
  beginTransaction() { return this.client.query("BEGIN") }
  commit() { return this.client.query("COMMIT") }
  rollback() { return this.client.query("ROLLBACK") }
  release() { this.client.release() }
}

/** Facade exposing the mysql2 `pool` surface the codebase uses. */
export const pool = {
  async query<T = any>(sql: string, params: any[] = []): Promise<[T, any]> {
    const res = await realPool.query(translate(sql), params)
    return [pack(res) as T, res.fields]
  },
  async getConnection(): Promise<PgConnection> {
    return new PgConnection(await realPool.connect())
  },
  end() { return realPool.end() },
}

/**
 * Runs a query with a single transient-error retry (exponential backoff),
 * absorbing brief connection drops without crashing the request.
 * SELECT resolves to the row array; writes resolve to { affectedRows }.
 */
export async function query<T = any>(sql: string, params: any[] = []): Promise<T> {
  try {
    const [rows] = await pool.query<T>(sql, params)
    return rows
  } catch (err: any) {
    const transient = ["PROTOCOL_CONNECTION_LOST", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"].includes(err?.code)
    if (!transient) throw err
    await new Promise((r) => setTimeout(r, 500))
    const [rows] = await pool.query<T>(sql, params)
    return rows
  }
}

export function getPool() {
  return pool
}

/** Runs fn inside a transaction guarded by a named advisory lock.
 *
 *  Uses TRANSACTION-scoped locks (pg_*_xact_lock), never session-scoped:
 *  through Supavisor's transaction pooler a session lock can end up held by
 *  a pooled backend connection that outlives the client — it then blocks
 *  every caller until the backend dies. A transaction lock always releases
 *  on COMMIT/rollback or backend death, so it cannot leak.
 *
 *  waitSeconds bounds the wait via lock_timeout; 0 = a single non-blocking
 *  try. Returns { acquired: false } when the lock couldn't be taken. */
export type AdvisoryLockOutcome<T> = { acquired: true; value: T } | { acquired: false }

export async function withAdvisoryLock<T>(
  name: string,
  waitSeconds: number,
  fn: (conn: PgConnection) => Promise<T>,
): Promise<AdvisoryLockOutcome<T>> {
  const conn = await pool.getConnection()
  try {
    await conn.query("BEGIN")
    const [tryRows] = await conn.query<any[]>(
      "SELECT pg_try_advisory_xact_lock(hashtextextended(?, 0)) AS a",
      [name],
    )
    let acquired = tryRows[0]?.a === true
    if (!acquired && waitSeconds > 0) {
      try {
        await conn.query("SELECT set_config('lock_timeout', ?, true)", [String(Math.round(waitSeconds * 1000))])
        await conn.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", [name])
        acquired = true
      } catch {
        acquired = false
      }
    }
    if (!acquired) {
      await conn.query("ROLLBACK").catch(() => {})
      return { acquired: false }
    }
    try {
      const value = await fn(conn)
      await conn.query("COMMIT")
      return { acquired: true, value }
    } catch (error) {
      await conn.query("ROLLBACK").catch(() => {})
      throw error
    }
  } finally {
    conn.release()
  }
}

export function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}
