import crypto from "node:crypto"
import { config } from "../config.js"
import { getPool } from "../db.js"

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
export function base32(bytes: Buffer) {
  let bits = 0, value = 0, output = ""
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8
    while (bits >= 5) { output += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31]
  return output
}
export function decode32(secret: string) {
  let bits = 0, value = 0; const bytes: number[] = []
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const index = alphabet.indexOf(char)
    if (index < 0) throw new Error("Invalid base32 secret")
    value = (value << 5) | index; bits += 5
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(bytes)
}
export function totp(secret: string, counter: number, digits = 6) {
  const data = Buffer.alloc(8); data.writeBigUInt64BE(BigInt(counter))
  const hash = crypto.createHmac("sha1", decode32(secret)).update(data).digest()
  const offset = hash[hash.length - 1] & 15
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).toString().padStart(digits, "0")
}
const key = () => crypto.createHash("sha256").update(process.env.TOTP_ENCRYPTION_KEY || config.jwtSecret).digest()
export function encryptSecret(secret: string) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key(), iv)
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map(b => b.toString("base64")).join(".")
}
export function decryptSecret(value: string) {
  const [iv, tag, ciphertext] = value.split(".").map(s => Buffer.from(s, "base64"))
  const cipher = crypto.createDecipheriv("aes-256-gcm", key(), iv); cipher.setAuthTag(tag)
  return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString("utf8")
}
export const backupHash = (value: string) => crypto.createHash("sha256").update(value).digest("hex")

// Serialize verification so neither TOTP steps nor recovery codes can be replayed.
export async function consumeCode(userId: string, code: string, pending = false) {
  const conn = await getPool().getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query<any[]>("SELECT * FROM two_factor_auth WHERE user_id = ? FOR UPDATE", [userId])
    const row = rows[0]
    if (!row || (!row.enabled && !pending)) return false
    const counter = Math.floor(Date.now() / 30000)
    const secret = decryptSecret(row.secret_key)
    for (const step of [counter, counter - 1, counter + 1]) {
      if (step > Number(row.last_counter) && /^\d{6}$/.test(code) && crypto.timingSafeEqual(Buffer.from(code), Buffer.from(totp(secret, step)))) {
        await conn.query("UPDATE two_factor_auth SET last_counter = ? WHERE tfa_id = ?", [step, row.tfa_id])
        await conn.commit(); return true
      }
    }
    const codes: string[] = typeof row.backup_codes === "string" ? JSON.parse(row.backup_codes) : row.backup_codes ?? []
    const index = codes.indexOf(backupHash(code))
    if (row.enabled && index >= 0) {
      codes.splice(index, 1)
      await conn.query("UPDATE two_factor_auth SET backup_codes = ? WHERE tfa_id = ?", [JSON.stringify(codes), row.tfa_id])
      await conn.commit(); return true
    }
    return false
  } finally { await conn.rollback(); conn.release() }
}
