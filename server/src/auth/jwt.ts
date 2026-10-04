import jwt from "jsonwebtoken"
import crypto from "node:crypto"
import { config } from "../config.js"

export type JwtPayload = {
  sub: string
  sid: string
  role: string
  name: string
  email: string
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: `${config.jwtExpiresHours}h` })
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as JwtPayload
  } catch {
    return null
  }
}

// Only the SHA-256 digest of the token is stored — a DB leak can't replay sessions.
export function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex")
}
