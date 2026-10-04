import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth } from "../auth/middleware.js"
import crypto from "node:crypto"
import { query } from "../db.js"
import { hashPassword, verifyPassword } from "../auth/password.js"
import { writeAudit } from "../lib/audit.js"
import { SUPPORTED_LANGUAGES } from "../lib/languages.js"

export const userProfileRouter = Router()

const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(255).optional(),
  phone: z.string().max(50).optional(),
  department: z.string().max(100).optional(),
  language: z.enum(SUPPORTED_LANGUAGES).optional(),
  timezone: z.string().max(50).refine(v => { try { new Intl.DateTimeFormat("en", { timeZone: v }); return true } catch { return false } }).optional(),
})

// Get current user's profile
userProfileRouter.get(["/", "/profile"], requireAuth, async (req, res) => {
  const rows = await query<any[]>(
    `SELECT user_id, full_name, email, role, facility_id, phone, department, language, timezone, avatar_url,
            profile_updated_at, last_login_at, created_at
     FROM users WHERE user_id = ?`,
    [req.user!.userId],
  )
  const user = rows[0]
  if (!user) return res.status(404).json({ error: "User not found" })
  res.json({ user })
})

// Update current user's profile
userProfileRouter.patch(["/", "/profile"], requireAuth, async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid profile data" })

  const { fullName, phone, department, language, timezone } = parsed.data
  const sets: string[] = []
  const params: any[] = []

  if (fullName !== undefined) {
    sets.push("full_name = ?")
    params.push(fullName)
  }
  if (phone !== undefined) {
    sets.push("phone = ?")
    params.push(phone)
  }
  if (department !== undefined) {
    sets.push("department = ?")
    params.push(department)
  }
  if (language !== undefined) {
    sets.push("language = ?")
    params.push(language)
  }
  if (timezone !== undefined) {
    sets.push("timezone = ?")
    params.push(timezone)
  }

  if (!sets.length) return res.status(400).json({ error: "Nothing to update" })

  sets.push("profile_updated_at = ?")
  params.push(new Date())
  params.push(req.user!.userId)

  await query(`UPDATE users SET ${sets.join(", ")} WHERE user_id = ?`, params)
  await writeAudit(req, { action: "update_profile", entityType: "users", entityId: req.user!.userId, details: parsed.data })

  res.json({ ok: true })
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, "Password must contain uppercase, lowercase, and number"),
})

// Change password
userProfileRouter.post("/change-password", requireAuth, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid password format" })

  const { currentPassword, newPassword } = parsed.data
  const rows = await query<any[]>("SELECT password_hash FROM users WHERE user_id = ?", [req.user!.userId])

  if (!rows[0] || !(await verifyPassword(rows[0].password_hash, currentPassword))) {
    // Increment failed attempts
    await query("UPDATE users SET failed_login_attempts = failed_login_attempts + 1 WHERE user_id = ?", [req.user!.userId])
    return res.status(401).json({ error: "Current password is incorrect" })
  }

  const hash = await hashPassword(newPassword)
  await query("UPDATE users SET password_hash = ?, failed_login_attempts = 0, profile_updated_at = ? WHERE user_id = ?", [hash, new Date(), req.user!.userId])

  // Revoke all other sessions
  await query("UPDATE sessions SET revoked = 1 WHERE user_id = ? AND session_id <> ?", [
    req.user!.userId,
    req.user!.sessionId,
  ])

  await writeAudit(req, { action: "change_password", entityType: "users", entityId: req.user!.userId })
  res.json({ ok: true })
})

// Get current user's active sessions
userProfileRouter.get("/sessions", requireAuth, async (req, res) => {
  const sessions = await query<any[]>(
    `SELECT session_id, ip_address, user_agent, created_at, expires_at, revoked
     FROM sessions WHERE user_id = ? ORDER BY created_at DESC`,
    [req.user!.userId],
  )
  res.json({ items: sessions.map(s => ({ ...s, current: s.session_id === req.user!.sessionId })) })
})

// Revoke specific session
userProfileRouter.delete("/sessions/:id", requireAuth, async (req, res) => {
  if (req.params.id === req.user!.sessionId) {
    return res.status(400).json({ error: "Cannot revoke current session" })
  }
  await query("UPDATE sessions SET revoked = 1 WHERE session_id = ? AND user_id = ?", [
    req.params.id,
    req.user!.userId,
  ])
  await writeAudit(req, { action: "revoke_session", entityType: "sessions", entityId: req.params.id })
  res.json({ ok: true })
})

// Revoke all other sessions
userProfileRouter.delete("/sessions", requireAuth, async (req, res) => {
  await query("UPDATE sessions SET revoked = 1 WHERE user_id = ? AND session_id <> ?", [
    req.user!.userId,
    req.user!.sessionId,
  ])
  await writeAudit(req, { action: "revoke_all_sessions", entityType: "sessions", entityId: req.user!.userId })
  res.json({ ok: true })
})

// Get user preferences
userProfileRouter.get("/preferences", requireAuth, async (req, res) => {
  const preferences = await query<any[]>(
    "SELECT preference_key, preference_value FROM user_preferences WHERE user_id = ?",
    [req.user!.userId],
  )
  const prefs: Record<string, any> = {}
  for (const pref of preferences) {
    prefs[pref.preference_key] = typeof pref.preference_value === "string" ? JSON.parse(pref.preference_value) : pref.preference_value
  }
  res.json({ preferences: prefs })
})

// Update user preferences
userProfileRouter.patch("/preferences", requireAuth, async (req, res) => {
  const { key, value } = req.body
  if (!(["theme", "language"].includes(key)) || (key === "theme" && !["light", "dark", "system"].includes(value)) || (key === "language" && !(SUPPORTED_LANGUAGES as readonly string[]).includes(value))) {
    return res.status(400).json({ error: "key and value are required" })
  }

  await query(
    `INSERT INTO user_preferences (preference_id, user_id, preference_key, preference_value, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE preference_value = VALUES(preference_value), updated_at = VALUES(updated_at)`,
    [crypto.randomUUID(), req.user!.userId, key, JSON.stringify(value), new Date()],
  )

  res.json({ ok: true })
})
