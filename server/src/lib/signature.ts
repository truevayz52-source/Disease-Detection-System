import crypto from "node:crypto"

/**
 * Deterministic, sorted, deep stringification of a JSON object.
 * Produces a stable canonical form for HMAC payloads without relying on
 * insertion order. Arrays keep their order; object keys sort ascending.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return "[" + value.map(canonicalStringify).join(",") + "]"
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return "{" + keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(",") + "}"
}

/** HMAC-SHA256 over a canonical JSON payload. */
export function signReport(payload: Record<string, unknown>, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(canonicalStringify(payload), "utf8")
    .digest("hex")
}

/** Timing-safe HMAC verification; returns a descriptive result for diagnostics. */
export function verifyReport(
  payload: Record<string, unknown>,
  storedHmac: string | null | undefined,
  secret: string,
): { valid: boolean; reason?: string } {
  if (!storedHmac) return { valid: false, reason: "unsigned" }
  const computed = signReport(payload, secret)
  try {
    const a = Buffer.from(computed, "hex")
    const b = Buffer.from(storedHmac, "hex")
    if (a.length !== b.length) return { valid: false, reason: "invalid_signature" }
    return { valid: crypto.timingSafeEqual(a, b), reason: crypto.timingSafeEqual(a, b) ? undefined : "invalid_signature" }
  } catch {
    return { valid: false, reason: "invalid_signature" }
  }
}
