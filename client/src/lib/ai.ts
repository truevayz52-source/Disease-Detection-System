import { api } from "./api"
import { maskPii, unmaskPii } from "./translate"

/**
 * Client for the guarded /api/ai endpoints. Text is masked CLIENT-side before
 * the request (the record's PII literals become ⟦n⟧ tokens), so neither the
 * wire nor the provider ever sees identifiers. Responses are unmasked locally.
 */

type PiiLiterals = (string | null | undefined)[]
const clean = (pii: PiiLiterals) => pii.filter((x): x is string => !!x?.trim())

function unmaskDeep(v: unknown, map: Record<string, string>): unknown {
  if (typeof v === "string") return unmaskPii(v, map)
  if (Array.isArray(v)) return v.map((x) => unmaskDeep(x, map))
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, unmaskDeep(val, map)]))
  return v
}

/** Plain-language summary of clinical narrative (autopsy findings, summaries). */
export async function aiSummarize(text: string, opts: { pii?: PiiLiterals; lang?: string } = {}): Promise<string> {
  const pii = clean(opts.pii ?? [])
  const { masked, map } = maskPii(text, pii)
  const res = await api<{ summary: string }>("/ai/summarize", {
    method: "POST",
    body: JSON.stringify({ text: masked, lang: opts.lang, pii }),
  })
  return unmaskPii(res.summary ?? "", map)
}

/** Structured field extraction from a reviewed transcript/VA narrative. */
export async function aiExtract(text: string, opts: { pii?: PiiLiterals } = {}): Promise<Record<string, unknown>> {
  const pii = clean(opts.pii ?? [])
  const { masked, map } = maskPii(text, pii)
  const res = await api<{ fields: Record<string, unknown> }>("/ai/extract", {
    method: "POST",
    body: JSON.stringify({ text: masked, pii }),
  })
  return (unmaskDeep(res.fields ?? {}, map) ?? {}) as Record<string, unknown>
}

/** Plain-language explanation of an outbreak alert from aggregates only. */
export async function aiExplainAlert(context: Record<string, string | number | boolean>, lang?: string): Promise<string> {
  const res = await api<{ explanation: string }>("/ai/explain", {
    method: "POST",
    body: JSON.stringify({ kind: "alert", context, lang }),
  })
  return res.explanation ?? ""
}
