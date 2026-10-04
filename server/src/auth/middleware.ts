import type { NextFunction, Request, Response } from "express"
import { consumeCode } from "./totp.js"
import { query } from "../db.js"
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

/** Stateful JWT check: valid signature AND live (non-revoked) session row. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req)
  if (!token) return res.status(401).json({ error: "Unauthorized" })

  const payload = verifyToken(token)
  if (!payload) return res.status(401).json({ error: "Invalid or expired token" })

  const rows = await query<any[]>(
    `SELECT s.session_id, s.expires_at, s.revoked, u.user_id, u.email, u.full_name, u.role, u.facility_id, u.province, u.district, u.status,
            u.phone, u.department, u.language, u.timezone, u.avatar_url, u.last_login_at,
            u.failed_login_attempts, u.locked_until
     FROM sessions s JOIN users u ON u.user_id = s.user_id
     WHERE s.token_hash = ?`,
    [tokenHash(token)],
  )
  const row = rows[0]
  if (!row || row.revoked || new Date(row.expires_at) < new Date() || row.status !== "active") {
    return res.status(401).json({ error: "Session expired or revoked" })
  }

  // Check if account is locked
  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    return res.status(403).json({ error: "Account locked due to too many failed login attempts" })
  }

  req.token = token
  req.user = {
    userId: row.user_id,
    sessionId: row.session_id,
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

/** Fine-grained permission check for specific actions */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" })
    
    // Role-based permission mapping
    const rolePermissions: Record<Role, string[]> = {
      medical_officer: ["create_notification", "view_facility_data", "initiate_mpdsr"],
      pathologist: ["view_pathology", "create_autopsy", "review_images"],
      public_health_analyst: ["view_analytics", "configure_alerts", "view_audit"],
      system_admin: ["*"], // Full access
      mortuary_clerk: ["create_notification", "view_facility_data", "generate_certificates"],
      executive: ["view_analytics", "view_reports"], // View-only access
    }
    
    const permissions = rolePermissions[req.user.role]
    if (!permissions || (!permissions.includes("*") && !permissions.includes(permission))) {
      return res.status(403).json({ error: "Forbidden: insufficient permissions" })
    }
    next()
  }
}

/** Facility-scoped access control for medical officers and clerks */
export function requireFacilityAccess() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" })
    
    // System admins and public health analysts have full access
    if (req.user.role === "system_admin" || req.user.role === "public_health_analyst") {
      return next()
    }
    
    // Pathologists and executives don't need facility access
    if (req.user.role === "pathologist" || req.user.role === "executive") {
      return next()
    }
    
    // Medical officers and clerks must have a facility assigned
    if (!req.user.facilityId) {
      return res.status(403).json({ error: "Forbidden: no facility assigned" })
    }
    
    next()
  }
}

/** View-only access for executive role */
export function requireViewOnly() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" })
    
    if (req.user.role === "executive") {
      // Block any mutation methods
      if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
        return res.status(403).json({ error: "Forbidden: executive role is view-only" })
      }
    }
    
    next()
  }
}

/** Require 2FA for sensitive operations */
export function require2FA() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" })
    
    // Check if user has 2FA enabled
    const rows = await query<any[]>(
      "SELECT enabled FROM two_factor_auth WHERE user_id = ?",
      [req.user.userId]
    )
    
    const tfaEnabled = Boolean(rows[0]?.enabled)
    
    // For now, 2FA is optional - skip if not enabled
    // In production, you might want to enforce 2FA for certain roles
    if (!tfaEnabled) {
      return next()
    }
    
    // Check for 2FA code in headers
    const tfaCode = req.headers["x-2fa-code"] as string
    if (!tfaCode) {
      return res.status(403).json({ error: "Forbidden: 2FA code required" })
    }
    
    if (!await consumeCode(req.user.userId, tfaCode)) return res.status(403).json({ error: "Invalid or already used 2FA code" })
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
