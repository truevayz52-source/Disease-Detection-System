import { Router } from "../lib/router.js"
import { z } from "zod"
import { newId, query } from "../db.js"
import { hashPassword, verifyPassword } from "../auth/password.js"
import { signToken, tokenHash } from "../auth/jwt.js"
import { consumeCode } from "../auth/totp.js"
import { requireAuth, rateLimiter } from "../auth/middleware.js"
import { writeAudit } from "../lib/audit.js"
import { config } from "../config.js"

export const authRouter = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
  code: z.string().max(32).optional(),
})

authRouter.post("/login", rateLimiter(30), async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid credentials format" })

  const { email, password } = parsed.data
  const rows = await query<any[]>(
    "SELECT user_id, full_name, email, password_hash, role, facility_id, province, district, status, failed_login_attempts, locked_until FROM users WHERE email = ? OR user_id IN (SELECT user_id FROM email_aliases WHERE email = ? AND expires_at > NOW())",
    [email.toLowerCase(), email.toLowerCase()],
  )
  const user = rows[0]

  const recordLogin = (success: boolean, failureReason?: string, userId?: string) =>
    query(
      "INSERT INTO login_history (history_id, user_id, email, success, failure_reason, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [newId("lh"), userId ?? null, email.toLowerCase(), success, failureReason ?? null, req.ip ?? null, req.headers["user-agent"] ?? null],
    ).catch(() => {})

  // Check if account is locked
  if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
    await recordLogin(false, "account_locked", user.user_id)
    await writeAudit(req, { action: "login_failed_locked", entityType: "auth", details: { email } })
    return res.status(403).json({ error: "Account locked due to too many failed login attempts" })
  }

  if (!user || !(await verifyPassword(user.password_hash, password))) {
    await recordLogin(false, "invalid_credentials", user?.user_id)
    // Increment failed login attempts
    if (user) {
      const newAttempts = (user.locked_until && new Date(user.locked_until) <= new Date() ? 0 : (user.failed_login_attempts || 0)) + 1
      const lockUntil = newAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null // Lock for 15 minutes after 5 failed attempts
      await query(
        "UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE user_id = ?",
        [newAttempts, lockUntil, user.user_id]
      )
    }
    await writeAudit(req, { action: "login_failed", entityType: "auth", details: { email } })
    return res.status(401).json({ error: "Invalid email or password" })
  }
  if (user.status !== "active") {
    await recordLogin(false, "account_disabled", user.user_id)
    return res.status(403).json({ error: "Account disabled" })
  }

  const [tfa] = await query<any[]>("SELECT enabled FROM two_factor_auth WHERE user_id = ?", [user.user_id])
  if (tfa?.enabled) {
    if (!parsed.data.code) return res.status(403).json({ error: "Enter your authenticator or recovery code", requiresTwoFactor: true })
    if (!await consumeCode(user.user_id, parsed.data.code)) {
      await query("UPDATE users SET failed_login_attempts=failed_login_attempts+1, locked_until=IF(failed_login_attempts>=5, DATE_ADD(NOW(), INTERVAL 15 MINUTE), NULL) WHERE user_id=?", [user.user_id])
      await writeAudit(req, { userId: user.user_id, action: "login_failed_2fa", entityType: "auth" })
      return res.status(403).json({ error: "Invalid or already used verification code" })
    }
  }
  await recordLogin(true, undefined, user.user_id)
  // Reset failed login attempts on successful login
  await query("UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = ? WHERE user_id = ?", [new Date(), user.user_id])

  const sessionId = newId("ses")
  const token = signToken({
    sub: user.user_id,
    sid: sessionId,
    role: user.role,
    name: user.full_name,
    email: user.email,
  })
  const expiresAt = new Date(Date.now() + config.jwtExpiresHours * 3600_000)
  await query(
    "INSERT INTO sessions (session_id, user_id, token_hash, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?)",
    [sessionId, user.user_id, tokenHash(token), expiresAt, req.ip ?? null, req.headers["user-agent"] ?? null],
  )
  await writeAudit(req, { userId: user.user_id, action: "login", entityType: "auth", entityId: sessionId })

  res.json({
    token,
    user: {
      userId: user.user_id,
      name: user.full_name,
      email: user.email,
      role: user.role,
      facilityId: user.facility_id,
      province: user.province ?? null,
      district: user.district ?? null,
    },
  })
})

authRouter.post("/logout", requireAuth, async (req, res) => {
  await query("UPDATE sessions SET revoked = 1 WHERE token_hash = ?", [tokenHash(req.token!)])
  await writeAudit(req, { action: "logout", entityType: "auth", entityId: req.user!.sessionId })
  res.json({ ok: true })
})

authRouter.get("/me", requireAuth, async (req, res) => {
  res.json({ user: req.user })
})

const changePwSchema = z.object({ 
  currentPassword: z.string().min(1), 
  newPassword: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, "Password must contain uppercase, lowercase, and number") 
})

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePwSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid password format. Must be at least 8 characters with uppercase, lowercase, and number" })

  const { currentPassword, newPassword } = parsed.data
  const rows = await query<any[]>("SELECT password_hash FROM users WHERE user_id = ?", [req.user!.userId])
  if (!rows[0] || !(await verifyPassword(rows[0].password_hash, currentPassword))) {
    // Increment failed attempts
    await query("UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE user_id = ?", [req.user!.userId])
    return res.status(401).json({ error: "Current password is incorrect" })
  }
  await query("INSERT INTO password_history (history_id, user_id, password_hash) VALUES (?, ?, ?)", [newId("ph"), req.user!.userId, rows[0].password_hash])
  const hash = await hashPassword(newPassword)
  await query("UPDATE users SET password_hash = ?, failed_login_attempts = 0, profile_updated_at = ? WHERE user_id = ?", [hash, new Date(), req.user!.userId])
  // Revoke all other sessions so the new password is required everywhere.
  await query("UPDATE sessions SET revoked = 1 WHERE user_id = ? AND session_id <> ?", [
    req.user!.userId,
    req.user!.sessionId,
  ])
  await writeAudit(req, { action: "change_password", entityType: "users", entityId: req.user!.userId })
  res.json({ ok: true })
})
