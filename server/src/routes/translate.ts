import { Router } from "../lib/router.js"
import { z } from "zod"
import crypto from "node:crypto"
import { requireAuth } from "../auth/middleware.js"
import { serviceJson, unavailable } from "../lib/integrations.js"
import { maskPii } from "../lib/deidentify.js"
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from "../lib/languages.js"
import { writeAudit } from "../lib/audit.js"

// POST /api/translate — de-identified machine translation for dynamic record
// text (autopsy findings, clinical summaries, transcripts). The Gemini API
// key stays server-side; the provider only ever sees masked text (⟦n⟧
// placeholders). Clients re-substitute placeholders for display.
export const translateRouter = Router()

const bodySchema = z.object({
  text: z.string().min(1).max(8000),
  targetLang: z.enum(SUPPORTED_LANGUAGES),
  pii: z.array(z.string().min(2).max(200)).max(24).optional(),
})

export function translateConfigured() {
  return Boolean(process.env.GEMINI_API_KEY)
}

const model = () => process.env.TRANSLATE_MODEL ?? "gemini-1.5-flash"

// Small in-memory LRU — identical passages are not re-sent to the provider.
const cache = new Map<string, string>()
const CACHE_MAX = 500
const cacheGet = (k: string) => {
  const v = cache.get(k)
  if (v !== undefined) { cache.delete(k); cache.set(k, v) }
  return v
}
const cacheSet = (k: string, v: string) => {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!)
  cache.set(k, v)
}

const geminiResponse = z.object({
  candidates: z.array(z.object({
    content: z.object({ parts: z.array(z.object({ text: z.string() })).min(1) }),
  })).min(1),
})

translateRouter.post("/translate", requireAuth, async (req, res) => {
  const parsed = bodySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid translation request" })

  const { text, targetLang, pii } = parsed.data
  if (targetLang === "en") return res.json({ translated: text, map: {}, provider: "none" })

  const { masked, map } = maskPii(text, pii ?? [])
  const cacheKey = crypto.createHash("sha256").update(`${targetLang}|${masked}`).digest("hex")
  const hit = cacheGet(cacheKey)
  if (hit) return res.json({ translated: hit, map, provider: "cache" })

  if (!translateConfigured()) throw unavailable("Translation provider is not configured")

  const prompt =
    `You are a medical translator for the Zimbabwe Ministry of Health and Child Care. ` +
    `Translate the following de-identified clinical text into ${LANGUAGE_NAMES[targetLang]}. ` +
    `Preserve bracketed tokens like ⟦1⟧ exactly and keep ICD-10 codes unchanged. ` +
    `Return only the translation.\n\n"${masked}"`

  const data = await serviceJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${model()}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    },
  )
  const out = geminiResponse.safeParse(data)
  if (!out.success) throw unavailable("Translation provider returned an invalid response")
  const translated = out.data.candidates[0].content.parts.map(p => p.text).join("").trim()

  cacheSet(cacheKey, translated)
  // Metadata only — clinical text is never written to the audit trail.
  void writeAudit(req, {
    action: "translate_text",
    entityType: "translation",
    details: { targetLang, chars: masked.length, maskedFields: Object.keys(map).length },
  }).catch(() => {})

  res.json({ translated, map, provider: "gemini" })
})
