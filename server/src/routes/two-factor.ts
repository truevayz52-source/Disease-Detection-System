import crypto from "node:crypto"
import { Router } from "../lib/router.js"
import { requireAuth, rateLimiter } from "../auth/middleware.js"
import { verifyPassword } from "../auth/password.js"
import { base32, encryptSecret, consumeCode, backupHash } from "../auth/totp.js"
import { query, newId, getPool } from "../db.js"
import { writeAudit } from "../lib/audit.js"

export const twoFactorRouter = Router()
twoFactorRouter.use(requireAuth, rateLimiter(15))
twoFactorRouter.get("/two-factor", async (req, res) => {
  const [row] = await query<any[]>("SELECT enabled FROM two_factor_auth WHERE user_id = ?", [req.user!.userId])
  res.json({ enabled: Boolean(row?.enabled) })
})
twoFactorRouter.post("/enable-2fa", async (req, res) => {
  const [user] = await query<any[]>("SELECT password_hash FROM users WHERE user_id = ?", [req.user!.userId])
  if (typeof req.body.password !== "string" || !await verifyPassword(user.password_hash, req.body.password)) return res.status(400).json({ error: "Current password is incorrect" })
  const connection = await getPool().getConnection()
  const secret = base32(crypto.randomBytes(20))
  try {
    await connection.beginTransaction()
    await connection.query("SELECT user_id FROM users WHERE user_id = ? FOR UPDATE", [req.user!.userId])
    const [rows] = await connection.query<any[]>("SELECT enabled FROM two_factor_auth WHERE user_id = ?", [req.user!.userId])
    if (rows[0]?.enabled) return res.status(409).json({ error: "Two-factor authentication is already enabled" })
    await connection.query("DELETE FROM two_factor_auth WHERE user_id = ?", [req.user!.userId])
    await connection.query("INSERT INTO two_factor_auth (tfa_id,user_id,secret_key) VALUES (?,?,?)", [newId("tfa"), req.user!.userId, encryptSecret(secret)])
    await connection.commit()
  } finally { await connection.rollback(); connection.release() }
  res.json({ secret, uri: `otpauth://totp/DDS:${encodeURIComponent(req.user!.email)}?secret=${secret}&issuer=DDS&algorithm=SHA1&digits=6&period=30` })
})
twoFactorRouter.post("/verify-2fa", async (req, res) => {
  const [row] = await query<any[]>("SELECT enabled FROM two_factor_auth WHERE user_id = ?", [req.user!.userId])
  if (row?.enabled) return res.status(409).json({ error: "Already enabled" })
  if (!await consumeCode(req.user!.userId, String(req.body.code ?? ""), true)) return res.status(400).json({ error: "Invalid or already used code" })
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(8).toString("hex"))
  await query("UPDATE two_factor_auth SET enabled = 1, backup_codes = ? WHERE user_id = ?", [JSON.stringify(codes.map(backupHash)), req.user!.userId])
  await query("UPDATE sessions SET revoked=1 WHERE user_id=? AND session_id<>?", [req.user!.userId, req.user!.sessionId])
  await writeAudit(req, { action: "enable_2fa", entityType: "users", entityId: req.user!.userId })
  res.json({ backupCodes: codes })
})
twoFactorRouter.post("/disable-2fa", async (req, res) => {
  const [user] = await query<any[]>("SELECT password_hash FROM users WHERE user_id = ?", [req.user!.userId])
  if (typeof req.body.password !== "string" || !await verifyPassword(user.password_hash, req.body.password) || !await consumeCode(req.user!.userId, String(req.body.code ?? ""))) return res.status(400).json({ error: "Password or verification code is incorrect" })
  await query("DELETE FROM two_factor_auth WHERE user_id = ?", [req.user!.userId])
  await writeAudit(req, { action: "disable_2fa", entityType: "users", entityId: req.user!.userId })
  res.json({ ok: true })
})
