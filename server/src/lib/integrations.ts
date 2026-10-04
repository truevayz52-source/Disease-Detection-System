import { z } from "zod"

export class ServiceUnavailableError extends Error { readonly status = 503 }
export function unavailable(message: string) { return new ServiceUnavailableError(message) }

export async function serviceJson(url: string, options: RequestInit = {}) {
  try {
    const response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(120000) })
    if (!response.ok) throw Error("Service rejected request")
    return await response.json()
  } catch { throw unavailable("The configured service is unavailable. Please try again later.") }
}

export const pathologyResult = z.object({
  modelVersion: z.string().min(1).max(50),
  anomalyScore: z.number().min(0).max(1),
  confidenceScore: z.number().min(0).max(1),
  regions: z.array(z.object({
    x: z.number().min(0).max(1), y: z.number().min(0).max(1),
    width: z.number().positive().max(1), height: z.number().positive().max(1),
  }).refine(r => r.x + r.width <= 1 && r.y + r.height <= 1)).max(100),
})

let whoToken: { value: string; expires: number } | undefined
export function whoConfigured() { return Boolean(process.env.WHO_CLIENT_ID && process.env.WHO_CLIENT_SECRET && process.env.WHO_ICD_RELEASE) }
export async function searchWho(q: string) {
  if (!whoConfigured()) throw unavailable("WHO ICD-11 credentials and release are not configured")
  if (!whoToken || whoToken.expires <= Date.now()) {
    const body = new URLSearchParams({ client_id: process.env.WHO_CLIENT_ID!, client_secret: process.env.WHO_CLIENT_SECRET!, grant_type: "client_credentials", scope: "icdapi_access" })
    const parsed = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() }).safeParse(await serviceJson("https://icdaccessmanagement.who.int/connect/token", { method: "POST", body }))
    if (!parsed.success) throw unavailable("WHO authentication returned an invalid response")
    whoToken = { value: parsed.data.access_token, expires: Date.now() + Math.max(0, parsed.data.expires_in - 60) * 1000 }
  }
  const url = new URL(`https://id.who.int/icd/release/11/${encodeURIComponent(process.env.WHO_ICD_RELEASE!)}/mms/search`)
  url.search = new URLSearchParams({ q, useFlexisearch: "true", flatResults: "true" }).toString()
  const response = await serviceJson(url.href, { headers: { Authorization: `Bearer ${whoToken.value}`, Accept: "application/json", "Accept-Language": "en", "API-Version": "v2" } })
  const parsed = z.object({ destinationEntities: z.array(z.object({ id: z.string(), title: z.string(), theCode: z.string().optional() })) }).safeParse(response)
  if (!parsed.success) throw unavailable("WHO search returned an invalid response")
  return parsed.data.destinationEntities.slice(0, 20).map(item => ({ uri: item.id, code: item.theCode || "", title: item.title.replace(/<[^>]*>/g, ""), version: "ICD-11", release: process.env.WHO_ICD_RELEASE }))
}
