import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole, ROLES } from "../auth/middleware.js"
import { newId, query } from "../db.js"
import { hashPassword } from "../auth/password.js"
import { writeAudit } from "../lib/audit.js"

export const usersRouter = Router()

const ADMIN = requireRole("system_admin")

usersRouter.get("/", requireAuth, ADMIN, async (_req, res) => {
  const rows = await query<any[]>(
    `SELECT u.user_id, u.full_name, u.email, u.role, u.status, u.facility_id, u.province, u.district, u.created_at,
            f.facility_name
     FROM users u LEFT JOIN facilities f ON f.facility_id = u.facility_id
     ORDER BY u.created_at`,
  )
  res.json({ items: rows })
})

const createSchema = z.object({
  fullName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, "Password must contain uppercase, lowercase, and number"),
  role: z.enum(ROLES as [string, ...string[]]),
  facilityId: z.string().optional().nullable(),
  phone: z.string().optional(),
  department: z.string().optional(),
  province: z.string().max(100).optional().nullable(),
  district: z.string().max(100).optional().nullable(),
})

usersRouter.post("/", requireAuth, ADMIN, async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid user data", issues: parsed.error.issues })
  const d = parsed.data

  const existing = await query<any[]>("SELECT user_id FROM users WHERE email = ?", [d.email.toLowerCase()])
  if (existing.length) return res.status(409).json({ error: "Email already registered" })
  if (d.facilityId) {
    const fac = await query<any[]>("SELECT facility_id FROM facilities WHERE facility_id = ?", [d.facilityId])
    if (!fac.length) return res.status(400).json({ error: "Unknown facility" })
  }

  const userId = newId("usr")
  const hash = await hashPassword(d.password)
  await query(
    "INSERT INTO users (user_id, full_name, email, password_hash, role, facility_id, phone, department, language, timezone, province, district) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [userId, d.fullName, d.email.toLowerCase(), hash, d.role, d.facilityId ?? null, d.phone ?? null, d.department ?? null, 'en', 'Africa/Harare', d.province ?? null, d.district ?? null],
  )
  await writeAudit(req, {
    action: "create_user",
    entityType: "users",
    entityId: userId,
    details: { email: d.email, role: d.role },
  })
  res.status(201).json({ userId })
})

const patchSchema = z.object({
  fullName: z.string().min(2).optional(),
  role: z.enum(ROLES as [string, ...string[]]).optional(),
  facilityId: z.string().nullable().optional(),
  status: z.enum(["active", "disabled"]).optional(),
  password: z.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, "Password must contain uppercase, lowercase, and number").optional(),
  phone: z.string().optional(),
  department: z.string().optional(),
  province: z.string().max(100).nullable().optional(),
  district: z.string().max(100).nullable().optional(),
})

usersRouter.patch("/:id", requireAuth, ADMIN, async (req, res) => {
  const parsed = patchSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid update" })
  const d = parsed.data

  const sets: string[] = []
  const params: any[] = []
  if (d.fullName !== undefined) {
    sets.push("full_name = ?")
    params.push(d.fullName)
  }
  if (d.role !== undefined) {
    sets.push("role = ?")
    params.push(d.role)
  }
  if (d.facilityId !== undefined) {
    sets.push("facility_id = ?")
    params.push(d.facilityId)
  }
  if (d.status !== undefined) {
    sets.push("status = ?")
    params.push(d.status)
  }
  if (d.password !== undefined) {
    sets.push("password_hash = ?")
    params.push(await hashPassword(d.password))
    sets.push("failed_login_attempts = 0")
  }
  if (d.fullName !== undefined || d.phone !== undefined || d.department !== undefined || d.password !== undefined) {
    sets.push("profile_updated_at = ?")
    params.push(new Date())
  }
  if (d.phone !== undefined) {
    sets.push("phone = ?")
    params.push(d.phone)
  }
  if (d.department !== undefined) {
    sets.push("department = ?")
    params.push(d.department)
  }
  if (d.province !== undefined) {
    sets.push("province = ?")
    params.push(d.province)
  }
  if (d.district !== undefined) {
    sets.push("district = ?")
    params.push(d.district)
  }
  if (!sets.length) return res.status(400).json({ error: "Nothing to update" })

  params.push(req.params.id)
  const result = await query<any>(`UPDATE users SET ${sets.join(", ")} WHERE user_id = ?`, params)
  if (!result.affectedRows) return res.status(404).json({ error: "User not found" })
  if (d.status === "disabled" || d.password !== undefined) {
    // Kill live sessions when an account is disabled or password reset.
    await query("UPDATE sessions SET revoked = 1 WHERE user_id = ?", [req.params.id])
  }
  await writeAudit(req, { action: "update_user", entityType: "users", entityId: req.params.id, details: d })
  res.json({ ok: true })
})
