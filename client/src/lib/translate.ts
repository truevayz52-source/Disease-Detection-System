import { api } from "./api"
import glossaryJson from "../i18n/medical-glossary.json"

/**
 * Dynamic clinical-text translation for the web client.
 * Order: in-memory cache -> server /api/translate (de-identified both sides)
 * -> offline medical-glossary substitution -> original text.
 * The browser never holds a translation API key.
 */

const cache = new Map<string, string>()
const MAX_CACHE = 200

const GLOSSARY = glossaryJson as unknown as Record<string, Record<string, string>>

/** PII masking — mirrors server/src/lib/deidentify.ts and the Dart port. */
export function maskPii(text: string, extraLiterals: string[] = []): { masked: string; map: Record<string, string> } {
  const map: Record<string, string> = {}
  let i = 0
  const repl = (m: string) => {
    const key = `\u27e6${++i}\u27e7`
    map[key] = m
    return key
  }
  let masked = text
  // caller-supplied literals first (names, IDs, facilities)
  for (const lit of extraLiterals) {
    if (!lit) continue
    masked = masked.split(lit).join(repl(lit))
  }
  const patterns = [
    /\b\d{2}-\d{6,7}[A-Z]\d{2}\b/g, // ZW national ID 00-000000X00
    /\b(?:\+263|0)\s?7[1-8]\d{6}\b/g, // ZW mobile
    /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, // email
    /-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,}/g, // coords
    /\b\d{7,}\b/g, // long digit runs
  ]
  for (const re of patterns) masked = masked.replace(re, repl)
  return { masked, map }
}

export function unmaskPii(text: string, map: Record<string, string>): string {
  let out = text
  for (const [k, v] of Object.entries(map)) out = out.split(k).join(v)
  return out
}

/** Substitute known medical terms from the bundled offline glossary. */
export function glossaryFallback(text: string, targetLang: string): string {
  let out = text
  for (const [en, translations] of Object.entries(GLOSSARY)) {
    const to = translations[targetLang]
    if (!to) continue
    out = out.replace(new RegExp(`\\b${en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), to)
  }
  return out
}

export type TranslateResult =
  | { text: string; source: "server" | "glossary" | "original" }
  | { text: string; source: "original"; unavailable: true }

/** Translate clinical narrative text. Never throws — falls back to the
 * original text so offline record viewing never breaks. */
export async function translateClinicalText(
  text: string,
  targetLang: string,
  pii: string[] = [],
): Promise<TranslateResult> {
  if (!text || targetLang === "en") return { text, source: "original" }
  const cacheKey = `${targetLang}:${text}`
  const hit = cache.get(cacheKey)
  if (hit) return { text: hit, source: "server" }
  try {
    const { masked, map } = maskPii(text, pii)
    const res = await api("/translate", {
      method: "POST",
      body: JSON.stringify({ text: masked, targetLang, pii }),
    })
    const translated = unmaskPii(String(res.translated ?? masked), map)
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!)
    cache.set(cacheKey, translated)
    return { text: translated, source: "server" }
  } catch {
    const gloss = glossaryFallback(text, targetLang)
    if (gloss !== text) return { text: gloss, source: "glossary" }
    return { text, source: "original", unavailable: true }
  }
}
