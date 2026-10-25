import type { NextFunction, Request, Response } from "express"
import jwt from "jsonwebtoken"
import * as jose from "jose"
import { query } from "../db.js"
import { config } from "../config.js"
import { tokenHash, verifyToken } from "./jwt.js"

export type Role = "medical_officer" | "pathologist" | "public_health_analyst" | "system_admin" | "mortuary_clerk" | "executive"

export const ROLES: Role[] = ["medical_officer", "pathologist", "public_health_analyst", "system_admin", "mortuary_clerk", "executive"]

export interface AuthUser {
  userId: string
  sessionId: string
  email: string
  name: string
  role: Role
  facilityId: string | null
  province: string | null
  district: string | null
  phone: string | null
  department: string | null
  language: string
  timezone: string
  avatarUrl: string | null
  lastLoginAt: string | null
  failedLoginAttempts: number
  lockedUntil: string | null
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
      token?: string
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization
  if (header?.startsWith("Bearer ")) return header.slice(7)
  // <img> tags can't set headers — allow ?token= on file GETs only.
  if (req.method === "GET" && /^\/api\/(images\/[^/]+\/file|notifications\/[^/]+\/certificate)$/.test(req.originalUrl.split("?")[0]) && typeof req.query.token === "string") return req.query.token
  return null
}

const USER_COLS = `u.user_id, u.email, u.full_name, u.role, u.facility_id, u.province, u.district, u.status,
  u.phone, u.department, u.language, u.timezone, u.avatar_url, u.last_login_at,
  u.failed_login_attempts, u.locked_until`

function toAuthUser(row: any, sessionId: string): AuthUser {
  return {
    userId: row.user_id,
    sessionId,
    email: row.email,
    name: row.full_name,
    role: row.role as Role,
    facilityId: row.facility_id,
    province: row.province ?? null,
    district: row.district ?? null,
    phone: row.phone,
    department: row.department,
    language: row.language || 'en',
    timezone: row.timezone || 'Africa/Harare',
    avatarUrl: row.avatar_url,
    lastLoginAt: row.last_login_at,
    failedLoginAttempts: row.failed_login_attempts || 0,
    lockedUntil: row.locked_until,
  }
}

/** Legacy path: our JWT signature AND a live (non-revoked) sessions row.
 *  Sliding idle timeout — each authenticated request bumps expires_at
 *  forward so a session lapses after SESSION_IDLE_MINUTES of inactivity. */
async function authenticateLegacy(token: string): Promise<AuthUser | null> {
  if (!verifyToken(token)) return null
  const rows = await query<any[]>(
    `SELECT s.session_id, s.expires_at, s.revoked, ${USER_COLS}
     FROM sessions s JOIN users u ON u.user_id = s.user_id
     WHERE s.token_hash = ?`,
    [tokenHash(token)],
  )
  const row = rows[0]
  if (!row || row.revoked || new Date(row.expires_at) < new Date() || row.status !== "active") return null
  // Slide the expiry forward — the session only dies when it goes quiet.
  await query("UPDATE sessions SET expires_at = ? WHERE session_id = ?", [
    new Date(Date.now() + config.sessionIdleMinutes * 60_000), row.session_id,
  ])
  return toAuthUser(row, row.session_id)
}

// New-style Supabase projects can sign tokens with asymmetric keys published
// at the auth JWKS endpoint instead of the legacy shared secret.
const supabaseJwks = config.supabaseJwksUrl ? jose.createRemoteJWKSet(new URL(config.supabaseJwksUrl)) : null

/** Verify a Supabase Auth JWT — legacy HS256 secret first, then JWKS. */
async function supabasePayload(token: string): Promise<Record<string, any> | null> {
  if (config.supabaseJwtSecret) {
    try {
      return jwt.verify(token, config.supabaseJwtSecret, { algorithms: ["HS256"], audience: "authenticated" }) as Record<string, any>
    } catch { /* fall through to JWKS */ }
  }
  if (supabaseJwks) {
    try {
      const { payload } = await jose.jwtVerify(token, supabaseJwks, { audience: "authenticated" })
      return payload as Record<string, any>
    } catch { return null }
  }
  return null
}

/** Supabase path: JWT verified by JWT secret or JWKS,
 *  aud = "authenticated", sub = auth.users.id -> users.auth_user_id. */
async function authenticateSupabase(token: string): Promise<AuthUser | null> {
  const payload = await supabasePayload(token)
  if (!payload) return null
  const sub = typeof payload?.sub === "string" ? payload.sub : null
  if (!sub) return null
  const rows = await query<any[]>(`SELECT ${USER_COLS} FROM users u WHERE u.auth_user_id = ?`, [sub])
  const row = rows[0]
  if (!row || row.status !== "active") return null
  const sessionId = typeof payload.session_id === "string" ? payload.session_id : `supabase:${sub}`
  return toAuthUser(row, sessionId)
}

/** Shared token resolver — legacy sessions first, then Supabase Auth JWTs.
 *  Roles and facility scoping always come from the users table either way. */
export async function authenticateToken(token: string): Promise<AuthUser | null> {
  return (await authenticateLegacy(token)) ?? (await authenticateSupabase(token))
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req)
  if (!token) return res.status(401).json({ error: "Unauthorized" })

  const user = await authenticateToken(token)
  if (!user) return res.status(401).json({ error: "Invalid or expired token" })

  // Check if account is locked
  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    return res.status(403).json({ error: "Account locked due to too many failed login attempts" })
  }

  req.token = token
  req.user = user

  // Executive role is strictly view-only. Enforcing at authentication means
  // no later route can accidentally allow a write by adding the role to a
  // requireRole() list (see also: case-workflow comments).
  if (req.user.role === "executive" && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return res.status(403).json({ error: "Forbidden: executive role is view-only" })
  }

  next()
}

/** RBAC gate (Chapter 4.7). Mount after requireAuth. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" })
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden: insufficient role" })
    }
    next()
  }
}

/** Simple rate limiter to prevent abuse */


export function rateLimiter(maxRequests: number = 100, windowMs: number = 60000) {
  const rateLimitMap = new Map<string, { count: number; resetTime: number }>()
  return (req: Request, res: Response, next: NextFunction) => {
    if (rateLimitMap.size > 10000) for (const [key, value] of rateLimitMap) if (value.resetTime < Date.now()) rateLimitMap.delete(key)
    const key = req.ip || "unknown"
    const now = Date.now()
    
    const limit = rateLimitMap.get(key)
    
    if (!limit || now > limit.resetTime) {
      rateLimitMap.set(key, { count: 1, resetTime: now + windowMs })
      return next()
    }
    
    if (limit.count >= maxRequests) {
      return res.status(429).json({ error: "Too many requests" })
    }
    
    limit.count++
    next()
  }
}
