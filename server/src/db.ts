import mysql from "mysql2/promise"
import { config } from "./config.js"

// Persistent connection pool with retry-friendly settings for intermittent
// network conditions typical of rural health facilities (see Chapter 5, 5.3).
const pool = mysql.createPool({
  host: config.mysql.host,
  port: config.mysql.port,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10,
  idleTimeout: 60000,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  decimalNumbers: true,
})

// Pin each pooled connection's session time zone so NOW()/CURDATE() in the
// detection queries don't drift with the DB server's TZ. Zimbabwe has no
// DST, so a fixed offset is safe; a failed SET is logged, not fatal.
pool.on("connection", (conn: any) => {
  conn.query("SET time_zone = ?", [config.mysqlTimeZone], (err: any) => {
    if (err) console.error("[db] failed to pin session time_zone:", err?.message ?? err)
  })
})

/**
 * Runs a query with a single transient-error retry (exponential backoff),
 * absorbing brief connection drops without crashing the request.
 */
export async function query<T = any>(sql: string, params: any[] = []): Promise<T> {
  try {
    const [rows] = await pool.query(sql, params)
    return rows as T
  } catch (err: any) {
    const transient = ["PROTOCOL_CONNECTION_LOST", "ECONNRESET", "ETIMEDOUT"].includes(err?.code)
    if (!transient) throw err
    await new Promise((r) => setTimeout(r, 500))
    const [rows] = await pool.query(sql, params)
    return rows as T
  }
}

export function getPool() {
  return pool
}

export function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}
