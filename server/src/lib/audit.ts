import crypto from "node:crypto"
import type { Request } from "express"
import { newId, query, getPool } from "../db.js"

/**
 * Immutable, tamper-evident audit trail (Chapter 4.7). Every entry's
 * record_hash = SHA256(previous_hash ‖ canonical payload), forming a chain —
 * editing or deleting history breaks verification in /audit/verify.
 */
export async function writeAudit(
  req: Request | null,
  entry: {
    userId?: string | null
    action: string
    entityType: string
    entityId?: string | null
    details?: Record<string, unknown>
  },
) {
  const connection = await getPool().getConnection()
  try {
  const [lock] = await connection.query<any[]>("SELECT GET_LOCK('dds_audit_append', 10) AS acquired")
  if (!lock[0]?.acquired) throw new Error("Audit writer busy")
  const query = async <T = any>(sql: string, params: any[] = []): Promise<T> => {
    const [rows] = await connection.query(sql, params); return rows as T
  }
  const last = await query<any[]>(
    "SELECT record_hash FROM audit_log ORDER BY chain_sequence DESC LIMIT 1",
  )
  const previousHash = last[0]?.record_hash ?? null
  const auditId = newId("aud")
  const ip = req?.ip ?? req?.socket?.remoteAddress ?? null
  const payload = JSON.stringify({
    audit_id: auditId,
    user_id: entry.userId ?? req?.user?.userId ?? null,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    ip_address: ip,
    details: entry.details ?? null,
    previous_hash: previousHash,
  })
  const recordHash = crypto.createHash("sha256").update((previousHash ?? "") + payload).digest("hex")

  await query(
    `INSERT INTO audit_log (audit_id, user_id, action, entity_type, entity_id, ip_address, details, record_hash, previous_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      auditId,
      entry.userId ?? req?.user?.userId ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      ip,
      entry.details ? JSON.stringify(entry.details) : null,
      recordHash,
      previousHash,
    ],
  )
  await query("UPDATE audit_log SET session_id = ?, device_fingerprint = ? WHERE audit_id = ?", [req?.user?.sessionId ?? null, crypto.createHash("sha256").update(req?.headers["user-agent"] ?? "unknown").digest("hex"), auditId])
  return auditId
  } finally {
    await connection.query("SELECT RELEASE_LOCK('dds_audit_append')")
    connection.release()
  }
}

/** Recomputes the whole chain — returns index/id of the first broken link. */
export async function verifyAuditChain(): Promise<{ valid: boolean; brokenAt?: string; checked: number }> {
  const storedRows = await query<any[]>(
    "SELECT audit_id, user_id, action, entity_type, entity_id, ip_address, details, record_hash, previous_hash, created_at FROM audit_log ORDER BY created_at ASC, audit_id ASC",
  )
  // Follow links instead of wall-clock timestamps (legacy rows had one-second precision).
  const children = new Map<string | null, any[]>()
  for (const row of storedRows) children.set(row.previous_hash, [...children.get(row.previous_hash) ?? [], row])
  const rows: any[] = []; let hash: string | null = null
  while (children.has(hash)) {
    const next: any[] = children.get(hash)!
    if (next.length !== 1 || rows.length >= storedRows.length) return { valid: false, brokenAt: next[0].audit_id, checked: rows.length }
    rows.push(next[0]); hash = next[0].record_hash
  }
  if (rows.length !== storedRows.length) return { valid: false, checked: rows.length }
  let prev: string | null = null
  for (const r of rows) {
    const details = typeof r.details === "string" ? JSON.parse(r.details) : r.details
    const payload = JSON.stringify({
      audit_id: r.audit_id,
      user_id: r.user_id,
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      ip_address: r.ip_address,
      details: details ?? null,
      previous_hash: r.previous_hash,
    })
    const expected = crypto.createHash("sha256").update((prev ?? "") + payload).digest("hex")
    if (expected !== r.record_hash || r.previous_hash !== prev) {
      return { valid: false, brokenAt: r.audit_id, checked: rows.length }
    }
    prev = r.record_hash
  }
  return { valid: true, checked: rows.length }
}
