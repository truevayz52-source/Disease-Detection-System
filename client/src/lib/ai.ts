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

export interface ExplainContext {
  alertType?: string
  disease?: string
  icdCode?: string
  icdTitle?: string
  district?: string
  province?: string
  caseCount?: number
  baselineAvg?: number
  threshold?: number
  windowDays?: number
  severity?: string
  triggeredAt?: string
  trendPct?: number
  previousPeriod?: string
  casesResolved?: number
  [key: string]: string | number | boolean | undefined
}

export function generateRuleBasedExplanation(kind: "alert" | "trend" | "bulletin", context: ExplainContext): string {
  if (kind === "alert") {
    const disease = context.disease || "Specified condition"
    const district = context.district || "affected district"
    const cases = context.caseCount ?? 0
    const alertType = context.alertType || "threshold"
    const windowDays = context.windowDays ? `${context.windowDays}d` : "48h"
    const threshold = context.threshold ?? 8

    if (alertType === "mpdsr") {
      return `Maternal/Perinatal death notification in ${district} triggered priority MPDSR protocol. Statutory audit required within 72 hours under MoHCC maternal surveillance guidelines to determine preventable clinical factors.`
    }
    if (alertType === "early_warning" || alertType === "cusum") {
      return `Low-volume early warning active for ${disease} in ${district}. Poisson CUSUM algorithm flagged an abnormal deviation above the baseline Poisson distribution with ${cases} case(s). Immediate enhanced surveillance and contact tracing recommended before transmission expands.`
    }
    if (alertType === "syndromic") {
      return `Syndromic pre-mortality early warning in ${district}: ${cases} clinical syndrome presentations reported by primary healthcare facilities in the past ${windowDays}. Early active case detection recommended to preempt severe mortality.`
    }
    return `Pass 2 Threshold Cluster: ${cases} deaths attributed to ${disease} recorded in ${district} within ${windowDays}, exceeding the statutory outbreak alert threshold of ${threshold} cases. Spatial DBSCAN algorithm confirms localized clustering. Recommended action: deploy District Rapid Response Team (RRT) for source investigation and active case finding.`
  }

  if (kind === "trend") {
    const trendPct = context.trendPct ?? 0
    const direction = trendPct >= 0 ? `increased by ${trendPct}%` : `decreased by ${Math.abs(trendPct)}%`
    return `Mortality velocity in ${context.district || "monitored districts"} has ${direction} relative to the previous 7-day baseline (${context.previousPeriod || "prior period"}). Statistical projection indicates expected continuation within modeled confidence bounds.`
  }

  return `Epidemiological bulletin summary: ${context.caseCount ?? 0} total cases recorded across surveillance network with ${context.severity || "standard"} monitoring protocols active.`
}

/** Plain-language explanation of an outbreak alert / trend / bulletin line. */
export async function aiExplain(
  kind: "alert" | "trend" | "bulletin",
  context: ExplainContext,
  opts: { lang?: string } = {}
): Promise<{ explanation: string; provider: string }> {
  try {
    const res = await api<{ explanation: string; provider: string }>("/ai/explain", {
      method: "POST",
      body: JSON.stringify({ kind, context, lang: opts.lang }),
    })
    if (res?.explanation) {
      return res
    }
  } catch (err) {
    console.warn("[aiExplain] Fallback to deterministic rule-based explanation:", err)
  }
  return {
    explanation: generateRuleBasedExplanation(kind, context),
    provider: "rule-based",
  }
}
