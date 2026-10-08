import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { Router } from "../lib/router.js"
import { requireAuth } from "../auth/middleware.js"
import { serviceJson, unavailable } from "../lib/integrations.js"
import { SUPPORTED_LANGUAGES, LANGUAGE_NAMES } from "../lib/languages.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const i18nDir = resolve(__dirname, "../../../i18n/lang")

type Dict = Record<string, string>

function loadDict(file: string): Dict {
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Dict
  } catch {
    return {}
  }
}

const geminiResponse = z.object({
  candidates: z.array(z.object({
    content: z.object({
      parts: z.array(z.object({ text: z.string() })).min(1),
    }),
  })).min(1),
})

const model = () => process.env.TRANSLATE_MODEL ?? "gemini-3.1-flash-lite"

export const i18nRouter = Router()

// GET /api/i18n/:lang — canonical dictionary merged with any remote supplement.
i18nRouter.get("/:lang", requireAuth, (req, res) => {
  const lang = req.params.lang
  if (!SUPPORTED_LANGUAGES.includes(lang as any)) {
    return res.status(400).json({ error: "Unsupported language code" })
  }
  const base = loadDict(resolve(i18nDir, `${lang}.json`))
  const remote = loadDict(resolve(i18nDir, `${lang}.remote.json`))
  res.json({ ...base, ...remote })
})

// POST /api/i18n/:lang/fill — use Gemini to translate missing UI keys and
// persist the result to a .remote.json supplement. Returns the full merged
// dictionary so clients can update immediately.
i18nRouter.post("/:lang/fill", requireAuth, async (req, res) => {
  const lang = req.params.lang
  if (!SUPPORTED_LANGUAGES.includes(lang as any) || lang === "en") {
    return res.status(400).json({ error: "Unsupported language code" })
  }

  const bodySchema = z.object({
    keys: z.array(z.string().min(1)).max(200),
  })
  const parsed = bodySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request: expected { keys: string[] }" })
  }

  if (!process.env.GEMINI_API_KEY) {
    throw unavailable("Translation provider is not configured")
  }

  const en = loadDict(resolve(i18nDir, "en.json"))
  const base = loadDict(resolve(i18nDir, `${lang}.json`))
  const remoteFile = resolve(i18nDir, `${lang}.remote.json`)
  const remote = loadDict(remoteFile)

  const missing = parsed.data.keys.filter((k) => base[k] == null && remote[k] == null)
  if (missing.length === 0) {
    return res.json({ ...base, ...remote })
  }

  const toTranslate: Record<string, string> = {}
  for (const k of missing) {
    if (en[k] != null) toTranslate[k] = en[k]
  }

  const prompt =
    `You are translating UI labels for the Zimbabwe Ministry of Health and Child Care ` +
    `disease surveillance application into ${LANGUAGE_NAMES[lang as keyof typeof LANGUAGE_NAMES]}. ` +
    `Translate the values in the following JSON object. Preserve any placeholders like {name}, {n}, etc. ` +
    `Keep text concise and suitable for mobile/web buttons, labels and headings. ` +
    `Return ONLY a JSON object with the same keys and no markdown, comments or explanation.\n\n` +
    `${JSON.stringify(toTranslate, null, 2)}`

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
  const raw = out.data.candidates[0].content.parts.map((p) => p.text).join("").trim()

  let generated: Dict = {}
  try {
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, "").trim()
    generated = JSON.parse(cleaned) as Dict
  } catch {
    throw unavailable("Translation provider returned invalid JSON")
  }

  const mergedRemote = { ...remote, ...generated }
  writeFileSync(remoteFile, JSON.stringify(mergedRemote, null, 2) + "\n")

  res.json({ ...base, ...mergedRemote })
})
