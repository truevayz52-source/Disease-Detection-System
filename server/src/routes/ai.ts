import { Router } from "../lib/router.js"
import { z } from "zod"
import { requireAuth, requireRole, rateLimiter } from "../auth/middleware.js"
import { writeAudit } from "../lib/audit.js"
import { explainContext, guardedGenerate, guardedGenerateJson } from "../lib/ai.js"
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from "../lib/languages.js"

// POST /api/ai/* — Gemini-assisted drafting/summarisation/extraction. Every
// free-text payload passes through lib/ai.ts: PII literals and identifier
// patterns become ⟦n⟧ tokens before dispatch, responses are unmasked
// server-side, and only metadata (never content) is audited.
export const aiRouter = Router()

const piiSchema = z.array(z.string().min(2).max(200)).max(24).optional()

const summarizeSchema = z.object({
  text: z.string().min(1).max(8000),
  lang: z.enum(SUPPORTED_LANGUAGES).optional(),
  pii: piiSchema,
})

// Plain-language summary of clinical narrative (autopsy findings, clinical
// summary, community reports) for the record viewer's convenience.
aiRouter.post("/summarize", requireAuth, rateLimiter(30), async (req, res) => {
  const parsed = summarizeSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid summarize request" })
  const { text, lang, pii } = parsed.data

  const langHint = lang && lang !== "en" ? ` in ${LANGUAGE_NAMES[lang]}` : ""
  const prompt =
    `You are a clinical documentation assistant for the Zimbabwe Ministry of Health ` +
    `and Child Care. Summarise the following de-identified clinical text${langHint} ` +
    `in at most 3 short sentences, suitable for a mortality surveillance record. ` +
    `⟦n⟧ tokens are redacted identifiers — keep them as-is and never reconstruct ` +
    `or invent identifying details. Do not add diagnoses beyond the source text.\n\nText:\n"""`

  const r = await guardedGenerate("summarize", prompt + `\n${text}\n"""`, pii ?? [])
  void writeAudit(req, {
    action: "ai_summarize",
    entityType: "ai_task",
    details: { chars: r.maskedChars, maskedFields: r.maskedFields, lang: lang ?? "en" },
  }).catch(() => {})
  res.json({ summary: r.output, provider: "gemini" })
})

const extractSchema = z.object({
  text: z.string().min(10).max(16000),
  pii: piiSchema,
})

// Structured extraction from a reviewed verbal-autopsy / transcription
// narrative: returns candidate death-notification fields for a reviewer to
// accept or edit — nothing is persisted by this endpoint.
aiRouter.post(
  "/extract",
  requireAuth,
  requireRole("medical_officer", "mortuary_clerk", "pathologist", "public_health_analyst", "system_admin"),
  rateLimiter(30),
  async (req, res) => {
    const parsed = extractSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "Invalid extract request" })
    const { text, pii } = parsed.data

    const prompt =
      `You are a clinical data-extraction assistant for the Zimbabwe Ministry of Health ` +
      `and Child Care death-notification workflow. From the following de-identified ` +
      `verbal-autopsy or clinical narrative, extract these fields. ⟦n⟧ tokens are ` +
      `redacted identifiers — copy them verbatim into fields where they belong; never ` +
      `invent a value. Return ONLY a JSON object with exactly these keys (null when ` +
      `unknown):\n` +
      `{"full_name":string|null,"age_years":number|null,"gender":"male"|"female"|"other"|null,` +
      `"date_of_death":string|null,"place_of_death":string|null,"address":string|null,` +
      `"circumstances":string|null,"symptoms":[string],"suspected_cause":string|null,` +
      `"suggested_icd10":string|null,"maternal_or_perinatal":boolean|null}\n\n` +
      `Text:\n"""`

    const r = await guardedGenerateJson("extract", prompt + `"""\n${text}\n"""`, pii ?? [])
    void writeAudit(req, {
      action: "ai_extract",
      entityType: "ai_task",
      details: { chars: r.maskedChars, maskedFields: r.maskedFields },
    }).catch(() => {})
    res.json({ fields: r.fields, provider: "gemini" })
  },
)

const explainSchema = z.object({
  kind: z.enum(["alert", "trend", "bulletin"]),
  context: z.unknown(),
  lang: z.enum(SUPPORTED_LANGUAGES).optional(),
})

// Plain-language explanation of an outbreak alert / trend / bulletin line.
// `context` is aggregate-only (counts, districts, thresholds) — the allowlist
// in lib/ai.ts makes it impossible to push record-level data to the provider.
aiRouter.post(
  "/explain",
  requireAuth,
  requireRole("medical_officer", "pathologist", "public_health_analyst", "system_admin", "executive"),
  rateLimiter(30),
  async (req, res) => {
    const parsed = explainSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: "Invalid explain request" })
    const { kind, lang } = parsed.data
    let context: Record<string, string | number | boolean>
    try {
      context = explainContext(parsed.data.context)
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : "Invalid context" })
    }

    const langHint = lang && lang !== "en" ? ` in ${LANGUAGE_NAMES[lang]}` : ""
    const prompt =
      `You are a public-health surveillance assistant for the Zimbabwe Ministry of ` +
      `Health and Child Care. Explain this ${kind} for an analyst bulletin${langHint} ` +
      `in 2–4 sentences: what the numbers mean, likely public-health significance, and ` +
      `one recommended next step. Use only the provided aggregate values; do not ` +
      `speculate about individuals. Context JSON: ${JSON.stringify(context)}`

    // Aggregate-only path — no PII literals exist in allowlisted context.
    const r = await guardedGenerate("explain", prompt, [])
    void writeAudit(req, {
      action: "ai_explain",
      entityType: "ai_task",
      details: { kind, keys: Object.keys(context).length, chars: r.maskedChars },
    }).catch(() => {})
    res.json({ explanation: r.output, provider: "gemini" })
  },
)
