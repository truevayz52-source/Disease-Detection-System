import { z } from "zod"
import { maskPii, unmaskPii } from "./deidentify.js"
import { serviceJson, unavailable } from "./integrations.js"

// Shared privacy gate for ALL external Gemini calls (translation uses its own
// copy of the same rules in routes/translate.ts). Contract:
//   1. Every free-text payload is de-identified via maskPii — caller-supplied
//      record literals (names, IDs, facility, provider) plus regex catches for
//      ZW national IDs, phones, emails and coordinates become ⟦n⟧ tokens.
//   2. Post-mask assertion — if any caller literal survives masking the call is
//      refused entirely; the provider never sees the real value.
//   3. Tokens in the provider response are re-substituted server-side, so the
//      client receives readable text while the provider only ever saw tokens.
//   4. Callers audit metadata only (task, char count, masked-field count) —
//      request and response text is never logged or stored.
//   5. Structured "explain" inputs are aggregate-only via an allowlist — no
//      record text or identifiers can reach the provider through that path.

export function aiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY)
}

// Preferred model first; cheaper fallbacks absorb free-tier congestion (503s).
const modelChain = () => [
  process.env.TRANSLATE_MODEL || "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
].filter((v, i, a) => a.indexOf(v) === i)

const geminiResponse = z.object({
  candidates: z.array(z.object({
    content: z.object({ parts: z.array(z.object({ text: z.string() })).min(1) }),
  })).min(1),
})

async function callGemini(prompt: string): Promise<string> {
  let lastErr: unknown
  for (const model of modelChain()) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const data = await serviceJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          },
        )
        const parsed = geminiResponse.safeParse(data)
        if (!parsed.success) throw unavailable("AI provider returned an invalid response")
        return parsed.data.candidates[0].content.parts.map((p) => p.text).join("").trim()
      } catch (e) {
        lastErr = e
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)))
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : unavailable("AI provider is unavailable")
}

export interface GuardedResult {
  /** Provider output with ⟦n⟧ tokens resolved back to their real values. */
  output: string
  /** The masked text exactly as sent to the provider (for audit/telemetry). */
  maskedChars: number
  maskedFields: number
}

/**
 * Run a free-text prompt through the privacy gate. `pii` must carry every
 * identifying literal from the record being processed (patient name, national
 * ID, facility, pathologist, address…). Output tokens are unmasked before the
 * caller sees the result.
 */
export async function guardedGenerate(task: string, text: string, pii: string[] = []): Promise<GuardedResult> {
  const { masked, map } = maskPii(text, pii)
  // Post-mask assertion — a surviving caller literal means the mask failed;
  // refuse the call rather than leak it.
  for (const lit of pii) {
    const v = lit?.trim()
    if (v && v.length >= 2 && masked.includes(v)) {
      throw new Error(`Privacy guard refused ${task}: unmasked identifier survived`)
    }
  }
  if (!aiConfigured()) throw unavailable("AI provider is not configured")
  const raw = await callGemini(masked)
  return { output: unmaskPii(raw, map), maskedChars: masked.length, maskedFields: Object.keys(map).length }
}

/** Same gate, but the provider returns JSON; every string value is unmasked. */
export async function guardedGenerateJson(task: string, text: string, pii: string[] = []): Promise<{ fields: Record<string, unknown>; maskedChars: number; maskedFields: number }> {
  const { masked, map } = maskPii(text, pii)
  for (const lit of pii) {
    const v = lit?.trim()
    if (v && v.length >= 2 && masked.includes(v)) {
      throw new Error(`Privacy guard refused ${task}: unmasked identifier survived`)
    }
  }
  if (!aiConfigured()) throw unavailable("AI provider is not configured")
  const raw = await callGemini(masked)
  const json = JSON.parse(raw.replace(/^```(?:json)?|```$/gm, "").trim())
  const unmaskDeep = (v: unknown): unknown => {
    if (typeof v === "string") return unmaskPii(v, map)
    if (Array.isArray(v)) return v.map(unmaskDeep)
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, unmaskDeep(val)]))
    return v
  }
  return { fields: unmaskDeep(json) as Record<string, unknown>, maskedChars: masked.length, maskedFields: Object.keys(map).length }
}

/**
 * Aggregate-only context for narrative "explain" calls. Every key is
 * allowlisted so record-level data (names, IDs, free text) cannot be smuggled
 * to the provider through this endpoint — values are scalars at most.
 */
const EXPLAIN_KEYS = new Set([
  "alertType", "disease", "icdCode", "icdTitle", "district", "province",
  "caseCount", "baselineAvg", "threshold", "windowDays", "severity",
  "triggeredAt", "trendPct", "previousPeriod", "casesResolved",
])
export function explainContext(input: unknown): Record<string, string | number | boolean> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("context must be an object")
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!EXPLAIN_KEYS.has(k)) throw new Error(`context key "${k}" is not allowed`)
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
      throw new Error(`context "${k}" must be a scalar`)
    }
    if (typeof v === "string" && v.length > 200) throw new Error(`context "${k}" too long`)
    out[k] = v
  }
  return out
}
