// Builds i18n/lang/<code>.json dictionaries from the English key inventory.
//
// Resolution order per key:
//   1. i18n/corpora/<code>.json   — human-verified strings (fetch-corpora.mjs)
//   2. existing dictionary value  — curated seeds are kept (use --force to redo)
//   3. machine translation        — Gemini (GEMINI_API_KEY) then MyMemory (keyless)
//   4. absent                     — runtime falls back to the English key itself
//
// Usage:
//   node scripts/build-dictionaries.mjs                 # all written languages
//   node scripts/build-dictionaries.mjs --langs sn,nd   # subset
//   node scripts/build-dictionaries.mjs --force         # regenerate MT entries
//   node scripts/build-dictionaries.mjs --dry-run       # report only
//
// GEMINI_API_KEY is read from the environment or server/.env. Without it only
// the corpora + MyMemory tiers run and a coverage gap report is printed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const langDir = join(root, "i18n", "lang")
const corporaDir = join(root, "i18n", "corpora")
const cacheDir = join(root, "i18n", ".cache")
const args = process.argv.slice(2)
const FORCE = args.includes("--force")
const DRY = args.includes("--dry-run")
const ONLY = (args.find((a) => a.startsWith("--langs=")) ?? "").replace("--langs=", "").split(",").filter(Boolean)

// ---- env -------------------------------------------------------------------
function envKey(name) {
  if (process.env[name]) return process.env[name]
  const envFile = join(root, "server", ".env")
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"))
    if (m) return m[1].trim()
  }
  return ""
}
const GEMINI_KEY = envKey("GEMINI_API_KEY")
// Congestion-prone free tier — try preferred model, then cheaper fallbacks.
const GEMINI_MODELS = [
  envKey("TRANSLATE_MODEL"),
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
].filter(Boolean)

// ---- language metadata ------------------------------------------------------
const languages = JSON.parse(readFileSync(join(root, "i18n", "languages.json"), "utf8"))
const en = JSON.parse(readFileSync(join(langDir, "en.json"), "utf8"))
const enKeys = Object.keys(en).filter((k) => !k.startsWith("_"))

// Prompt-facing language names + linguistic hints for low-resource languages.
const PROMPT_LANG = {
  sn: "chiShona (Shona, Bantu language of Zimbabwe)",
  nd: "isiNdebele (Zimbabwean Ndebele, Nguni Bantu language)",
  ny: "Chichewa / Chinyanja (Bantu language)",
  ts: "Xitsonga (Bantu language, also called Shangani in Zimbabwe)",
  st: "Sesotho (Southern Sotho, Bantu language)",
  tn: "Setswana (Bantu language)",
  ve: "Tshivenda (Bantu language)",
  xh: "isiXhosa (Nguni Bantu language)",
  toi: "chiTonga of Zimbabwe and Zambia (Zambezi-valley Bantu language — NOT Polynesian Tongan)",
  kck: "TjiKalanga (Kalanga, Bantu language of western Zimbabwe related to Shona)",
  nmq: "ChiNambya (Bantu language of northwestern Zimbabwe, related to Tonga and Shona)",
  ndc: "ChiNdau (Bantu language of southeastern Zimbabwe, closely related to Shona)",
  sbn: "Chibarwe (Bantu language of northern Zimbabwe, related to Shona and Nambya)",
  huc: "Tshwa (Khoe-Kwadi hunter-gatherer language of western Zimbabwe — approximate where unsure)",
}
// MyMemory/ISO codes where they differ from ours.
const ISO = { sn: "sn", nd: "nd", ny: "ny", ts: "ts", st: "st", tn: "tn", ve: "ve", xh: "xh", toi: "toi", kck: "kal", nmq: "nmq", ndc: "ndc", sbn: "sbn", huc: "huc" }

// ---- caches -----------------------------------------------------------------
const cacheFile = join(cacheDir, "translations.json")
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {}
const saveCache = () => {
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(cacheFile, JSON.stringify(cache, null, 2) + "\n")
}
const ck = (prov, code, key) => `${prov}|${code}|${key}`

// ---- validation -------------------------------------------------------------
const placeholderRe = /\{[^{}]+\}/g
function valid(key, val) {
  if (!val || typeof val !== "string" || !val.trim()) return false
  for (const p of key.match(placeholderRe) ?? []) if (!val.includes(p)) return false
  return true
}

// ---- providers --------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function geminiOnce(model, code, keys) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  const payload = Object.fromEntries(keys.map((k) => [k, k]))
  const prompt =
    `You are a localization engine for a mortality-surveillance application used by the ` +
    `Zimbabwe Ministry of Health and Child Care (death notification, pathology review, ` +
    `autopsy certification, outbreak analytics).\n` +
    `Translate each JSON VALUE from English into ${PROMPT_LANG[code]}.\n` +
    `Rules: return ONLY a JSON object with the SAME KEYS and translated values; keep ` +
    `{placeholders} exactly; keep acronyms/brand names (MOHCC, MPDSR, ICD-10, GPS, CSV, ` +
    `USB, PIN) untranslated; keep ellipses and punctuation; UI labels stay concise; ` +
    `use the clinical register used in Zimbabwean health facilities.\n` +
    `Input JSON:\n${JSON.stringify(payload)}`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 75000)
  const res = await fetch(`${url}?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: ctl.signal,
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }),
  }).finally(() => clearTimeout(timer))
  if (res.status === 429 || res.status === 503) throw Object.assign(new Error(`gemini ${res.status}`), { transient: true })
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? ""
  return JSON.parse(text)
}

// Retry a batch across the model list with backoff; throws only when every
// attempt failed permanently (each model × a few rounds).
async function geminiBatch(code, keys) {
  const delays = [0, 8000, 20000, 45000]
  let lastErr
  for (let round = 0; round < delays.length; round++) {
    for (const model of GEMINI_MODELS) {
      try {
        return await geminiOnce(model, code, keys)
      } catch (e) {
        lastErr = e
        if (!e.transient && e.name !== "AbortError" && !/JSON/.test(e.name)) throw e
      }
    }
    await sleep(delays[round])
  }
  throw lastErr
}

async function mymemory(code, key) {
  const iso = ISO[code]
  if (!iso) return null
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(key)}&langpair=en|${iso}`
  const res = await fetch(url, { headers: { "user-agent": "dds-i18n/1.0" } })
  if (!res.ok) return null
  const data = await res.json()
  const t = data?.responseData?.translatedText
  if (typeof t !== "string" || !t.trim()) return null
  if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(t)) return null
  return t.trim()
}

// ---- main -------------------------------------------------------------------
const report = []
for (const code of ONLY.length ? ONLY : Object.keys(languages)) {
  if (code === "en" || code === "zsl" || languages[code]?.written === false) continue

  const dictPath = join(langDir, `${code}.json`)
  const existing = existsSync(dictPath) ? JSON.parse(readFileSync(dictPath, "utf8")) : {}
  const corpusPath = join(corporaDir, `${code}.json`)
  const corpus = existsSync(corpusPath)
    ? Object.fromEntries(Object.entries(JSON.parse(readFileSync(corpusPath, "utf8"))).filter(([k]) => !k.startsWith("_")))
    : {}

  const have = new Set()
  for (const k of enKeys) {
    if (corpus[k] && valid(k, corpus[k])) have.add(k)
    else if (!FORCE && existing[k] && typeof existing[k] === "string" && existing[k].trim() && existing[k] !== k) have.add(k)
    else if (!FORCE && existing[k] && existing[k].trim()) have.add(k) // curated value == key (e.g. acronyms)
  }
  const missing = enKeys.filter((k) => !have.has(k))
  if (!missing.length) { report.push(`${code}: complete (0 missing)`); continue }

  // Apply corpora + cached MT first, then provider calls only for the remainder.
  const gained = {}
  let geminiNeeded = []
  for (const k of missing) {
    const hit = cache[ck("gemini", code, k)] ?? cache[ck("mymemory", code, k)]
    if (hit && valid(k, hit)) gained[k] = hit
    else geminiNeeded.push(k)
  }

  let mt = 0, fail = 0
  if (GEMINI_KEY) {
    const BATCH = 45
    for (let i = 0; i < geminiNeeded.length; i += BATCH) {
      const chunk = geminiNeeded.slice(i, i + BATCH)
      try {
        const out = await geminiBatch(code, chunk)
        for (const k of chunk) {
          const v = typeof out[k] === "string" ? out[k].trim() : ""
          if (valid(k, v)) { gained[k] = v; cache[ck("gemini", code, k)] = v; mt++ }
          else fail++
        }
      } catch (e) {
        console.error(`  gemini batch failed (${code}, ${i}): ${e.message}`)
        fail += chunk.length
      }
      if (i + BATCH < geminiNeeded.length) await sleep(2500) // free-tier RPM headroom
      saveCache()
    }
  } else {
    // Keyless tier: MyMemory, throttled, short strings only.
    for (const k of geminiNeeded) {
      if (k.length > 400) { fail++; continue }
      try {
        const v = await mymemory(code, k)
        if (v && valid(k, v)) { gained[k] = v; cache[ck("mymemory", code, k)] = v; mt++ }
        else fail++
      } catch { fail++ }
      await sleep(1200)
    }
  }

  const merged = { _meta: meta(existing, code, corpus, mt) }
  for (const k of enKeys) {
    const v = corpus[k] && valid(k, corpus[k]) ? corpus[k]
      : (!FORCE && typeof existing[k] === "string" && existing[k].trim() ? existing[k] : null)
      ?? gained[k]
    if (v) merged[k] = v
  }
  const coverage = ((Object.keys(merged).length - 1) / enKeys.length * 100).toFixed(1)
  report.push(`${code}: corpus=${Object.keys(corpus).length} kept=${Object.keys(existing).filter(k=>!k.startsWith("_")).length} new-MT=${mt} failed=${fail} → ${coverage}%`)
  if (!DRY) writeFileSync(dictPath, JSON.stringify(merged, null, 2) + "\n")
}

function meta(existing, code, corpus, mt) {
  const base = typeof existing?._meta === "string" ? existing._meta : "DRAFT — machine-generated; needs native-speaker review before clinical use."
  return `${base.split(" | built:")[0]} | built: ${new Date().toISOString().slice(0, 10)} (corpora ${Object.keys(corpus).length}, MT ${mt})`
}

saveCache()
console.log(report.join("\n"))
if (!GEMINI_KEY) console.log("\nNote: GEMINI_API_KEY not set — only corpora + MyMemory tiers ran. Set it in server/.env and re-run for full coverage.")
