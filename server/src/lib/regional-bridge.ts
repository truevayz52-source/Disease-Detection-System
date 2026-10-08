import { z } from "zod"
import { query } from "../db.js"
import { serviceJson } from "./integrations.js"

/**
 * Regional bridge — pushes aggregate mortality indicators to the national
 * health exchange. Two targets, each independently optional:
 *
 *   DHIS2   — Zimbabwe MoHCC runs DHIS2 as its HMIS. We POST a
 *             /api/dataValueSets payload (counts only, never case data).
 *   OpenHIM — an OpenHIE mediator channel receives a FHIR R4 MeasureReport
 *             of the same aggregate.
 *
 * Env (server/.env):
 *   DHIS2_BASE_URL=https://play.im.dhis2.org/stable-2-43-2   (dev demo)
 *   DHIS2_USERNAME / DHIS2_PASSWORD   or   DHIS2_API_TOKEN (PAT)
 *   DHIS2_DATASET=<dataSet id>   DHIS2_ORGUNIT=<orgUnit id>
 *   DHIS2_ELEMENT_MAP={"<disease_category>":"<dataElement id>", "*":"<default>"}
 *   OPENHIM_BASE_URL / OPENHIM_TOKEN / OPENHIM_CHANNEL_PATH
 */

export function dhis2Configured() {
  return Boolean(
    process.env.DHIS2_BASE_URL && process.env.DHIS2_DATASET &&
      process.env.DHIS2_ORGUNIT &&
      (process.env.DHIS2_API_TOKEN ||
        (process.env.DHIS2_USERNAME && process.env.DHIS2_PASSWORD)),
  )
}

export function openhimConfigured() {
  return Boolean(process.env.OPENHIM_BASE_URL && process.env.OPENHIM_TOKEN)
}

export function regionalStatus() {
  const parts: string[] = []
  parts.push(
    dhis2Configured()
      ? `DHIS2 → ${process.env.DHIS2_BASE_URL} (aggregates only, push on demand)`
      : "DHIS2 not_configured",
  )
  parts.push(
    openhimConfigured()
      ? `OpenHIM → ${process.env.OPENHIM_BASE_URL}`
      : "OpenHIM not_configured",
  )
  return parts.join("; ")
}

interface DistrictRow {
  district: string
  disease_category: string
  deaths: number
}

/** Aggregate the reporting window into district/category counts —
 *  same join the built-in analytics and scheduled reports use. */
async function districtAggregate(days: number): Promise<DistrictRow[]> {
  return query<DistrictRow[]>(
    `SELECT f.district AS district, ic.disease_category AS disease_category,
            COUNT(*) AS deaths
       FROM death_notifications dn
       JOIN facilities f ON f.facility_id = dn.facility_id
       JOIN icd_codes ic ON ic.icd_code = dn.preliminary_icd_code
      WHERE dn.date_of_death >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY f.district, ic.disease_category`,
    [days],
  )
}

/** yyyyMM for the period covering the window end. */
function periodOf(days: number) {
  const end = new Date()
  end.setUTCDate(end.getUTCDate() - 0) // window includes today
  if (days <= 31) {
    return `${end.getUTCFullYear()}${String(end.getUTCMonth() + 1).padStart(2, "0")}`
  }
  return `${end.getUTCFullYear()}` // yearly for longer windows
}

const counts = z.object({
  imported: z.number().optional(),
  updated: z.number().optional(),
  ignored: z.number().optional(),
  deleted: z.number().optional(),
})
// DHIS2 2.43+ nests the summary under `response`; older versions put it flat.
const importSummary = z.object({
  status: z.string().optional(),
  importCount: counts.partial().optional(),
  response: z
    .object({
      importCount: counts.partial().optional(),
      conflicts: z
        .array(z.object({ object: z.string().optional() }).partial())
        .optional(),
    })
    .partial()
    .optional(),
  conflicts: z.array(z.object({ object: z.string().optional() }).partial()).optional(),
}).loose()

/**
 * POST the window aggregate to DHIS2 /api/dataValueSets.
 * Element mapping is env-driven: DHIS2_ELEMENT_MAP JSON maps our
 * disease_category → dataElement id; "*" is the catch-all element.
 */
export async function pushToDhis2(days: number) {
  if (!dhis2Configured()) throw Error("DHIS2 is not configured")
  const rows = await districtAggregate(days)
  const map = (() => {
    try {
      return JSON.parse(process.env.DHIS2_ELEMENT_MAP || "{}") as Record<string, string>
    } catch {
      return {} as Record<string, string>
    }
  })()
  const fallback = map["*"]

  // Many categories can map to the same dataElement — sum them into ONE
  // dataValue per element or DHIS2 rejects the set with a 409 conflict.
  const perElement = new Map<string, number>()
  for (const r of rows) {
    const el = map[r.disease_category] ?? fallback
    if (el) perElement.set(el, (perElement.get(el) ?? 0) + Number(r.deaths))
  }
  const dataValues = [...perElement.entries()].map(([dataElement, n]) => ({
    dataElement,
    value: String(n),
  }))
  if (dataValues.length === 0) {
    throw Error("No mapped data elements — set DHIS2_ELEMENT_MAP")
  }

  const base = process.env.DHIS2_BASE_URL!.replace(/\/$/, "")
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (process.env.DHIS2_API_TOKEN) {
    headers["Authorization"] = `ApiToken ${process.env.DHIS2_API_TOKEN}`
  } else {
    headers["Authorization"] =
      "Basic " +
      Buffer.from(
        `${process.env.DHIS2_USERNAME}:${process.env.DHIS2_PASSWORD}`,
      ).toString("base64")
  }

  const payload = {
    dataSet: process.env.DHIS2_DATASET,
    completeDate: new Date().toISOString().slice(0, 10),
    period: periodOf(days),
    orgUnit: process.env.DHIS2_ORGUNIT,
    dataValues,
  }
  const res = await serviceJson(`${base}/api/dataValueSets`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  })
  const parsed = importSummary.safeParse(res)
  return {
    pushed: dataValues.length,
    period: payload.period,
    importCount: parsed.success
      ? (parsed.data.response?.importCount ?? parsed.data.importCount)
      : undefined,
    conflicts: parsed.success
      ? (parsed.data.response?.conflicts ?? parsed.data.conflicts ?? [])
      : [],
  }
}

/**
 * Forward the same aggregate to an OpenHIM mediator channel as a FHIR R4
 * MeasureReport bundle.
 */
export async function forwardToOpenhim(days: number) {
  if (!openhimConfigured()) throw Error("OpenHIM is not configured")
  const rows = await districtAggregate(days)
  const total = rows.reduce((a, r) => a + r.deaths, 0)

  const bundle = {
    resourceType: "Bundle",
    type: "collection",
    entry: [
      {
        resource: {
          resourceType: "MeasureReport",
          status: "complete",
          type: "summary",
          measure: "urn:dds:mortality:district-aggregate",
          period: {
            start: new Date(Date.now() - days * 86400000).toISOString(),
            end: new Date().toISOString(),
          },
          group: rows.map((r) => ({
            code: { text: `${r.district} / ${r.disease_category}` },
            population: [{ code: { text: "deaths" }, count: r.deaths }],
          })),
          extension: [
            {
              url: "urn:dds:total-deaths",
              valueInteger: total,
            },
          ],
        },
      },
    ],
  }
  const base = process.env.OPENHIM_BASE_URL!.replace(/\/$/, "")
  const path = process.env.OPENHIM_CHANNEL_PATH || "/dds/mortality"
  return serviceJson(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/fhir+json",
      authorization: `Bearer ${process.env.OPENHIM_TOKEN}`,
    },
    body: JSON.stringify(bundle),
  })
}
