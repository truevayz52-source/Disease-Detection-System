import { Router } from "../lib/router.js"
import { z } from "zod"
import { newId, query } from "../db.js"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { writeAudit } from "../lib/audit.js"
import { scopeWhere } from "../lib/scope.js"
import { SYNDROMES, SYNDROME_CATEGORY, type Syndrome } from "../lib/syndromes.js"
import { detectOutbreaksCoalesced } from "../lib/outbreak.js"

export const morbidityRouter = Router()

// Aggregate facility/lab case counts — the pre-mortality feed. Ingest is
// clinical/integration roles; reads add analyst visibility. Rows carry no
// patient PII, only counts per syndrome per period.
const ingestRoles = ["medical_officer", "public_health_analyst", "system_admin"] as const
const readRoles = ["medical_officer", "mortuary_clerk", "public_health_analyst", "pathologist", "system_admin", "executive"] as const

const reportSchema = z.object({
  externalId: z.string().max(128).optional(),
  facilityId: z.string().max(36).optional(),
  district: z.string().min(1).max(100),
  province: z.string().max(100).optional(),
  syndrome: z.enum(SYNDROMES),
  icdCode: z.string().max(12).optional(),
  caseCount: z.number().int().min(1).max(1_000_000),
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceChannel: z.enum(["facility", "fhir", "dhis2", "lab", "community", "offline"]).default("facility"),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  notes: z.string().max(4000).optional(),
})
export type MorbidityReportInput = z.infer<typeof reportSchema>

const createSchema = z.union([
  reportSchema,
  z.object({ reports: z.array(reportSchema).min(1).max(500) }),
])

/** Shared insert used by the REST endpoint and the FHIR facade. Dedupes on
 *  external_id, resolves disease_category (explicit ICD beats the syndrome
 *  map), then nudges the outbreak engine so qualifying clusters alert
 *  within seconds rather than on the 8-minute sweep. */
export async function insertMorbidityReports(items: MorbidityReportInput[], userId: string | null):
  Promise<{ reportIds: string[]; duplicates: string[] } | { error: string }> {
  const reportIds: string[] = []
  const duplicates: string[] = []
  for (const d of items) {
    if (d.externalId) {
      const dup = await query<any[]>("SELECT report_id FROM morbidity_reports WHERE external_id = ?", [d.externalId])
      if (dup[0]) { duplicates.push(dup[0].report_id); continue }
    }

    let category = SYNDROME_CATEGORY[d.syndrome as Syndrome] ?? "Ill-defined"
    if (d.icdCode) {
      const icd = await query<any[]>("SELECT disease_category FROM icd_codes WHERE icd_code = ?", [d.icdCode])
      if (!icd[0]) return { error: `Unknown ICD code: ${d.icdCode}` as const }
      category = icd[0].disease_category
    }

    // Reporter's facility is the default when the payload omits it — keeps
    // district truthful for single-facility officers.
    let facilityId = d.facilityId ?? null
    let district = d.district
    if (facilityId) {
      const fac = await query<any[]>("SELECT district, province FROM facilities WHERE facility_id = ?", [facilityId])
      if (fac[0]) { district = fac[0].district ?? district }
    }
    if (!district) return { error: "Report has no resolvable district" as const }

    const id = newId("mrb")
    await query(
      `INSERT INTO morbidity_reports
       (report_id, external_id, facility_id, district, province, syndrome, icd_code, disease_category,
        case_count, period_start, period_end, source_channel, severity, notes, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, d.externalId ?? null, facilityId, district, d.province ?? null, d.syndrome,
       d.icdCode ?? null, category, d.caseCount, d.periodStart, d.periodEnd,
       d.sourceChannel, d.severity, d.notes ?? null, userId],
    )
    reportIds.push(id)
  }
  return { reportIds, duplicates }
}

morbidityRouter.post("/", requireAuth, requireRole(...ingestRoles), async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid morbidity report data", issues: parsed.error.issues })
  const items = "reports" in parsed.data ? parsed.data.reports : [parsed.data]

  const result = await insertMorbidityReports(items, req.user!.userId)
  if ("error" in result) return res.status(400).json({ error: result.error })

  await writeAudit(req, { action: "morbidity_reported", entityType: "morbidity_reports", entityId: result.reportIds[0] ?? null, details: { inserted: result.reportIds.length } })
  void detectOutbreaksCoalesced(undefined, true).catch(() => [])
  res.status(201).json({ inserted: result.reportIds.length, reportIds: result.reportIds, duplicates: result.duplicates })
})

morbidityRouter.get("/", requireAuth, requireRole(...readRoles), async (req, res) => {
  const { district, syndrome, category, sourceChannel } = req.query as Record<string, string | undefined>
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 200))
  const filters = (alias: string) => {
    const params: any[] = []
    let whereSql = "WHERE 1=1"
    const scope = scopeWhere(req.user!, alias)
    if (scope.where) { whereSql += ` AND (${scope.where})`; params.push(...scope.params) }
    if (district) { whereSql += ` AND ${alias}.district = ?`; params.push(district) }
    if (syndrome) { whereSql += ` AND ${alias}.syndrome = ?`; params.push(syndrome) }
    if (category) { whereSql += ` AND ${alias}.disease_category = ?`; params.push(category) }
    if (sourceChannel) { whereSql += ` AND ${alias}.source_channel = ?`; params.push(sourceChannel) }
    return { whereSql, params }
  }
  const count = filters("morbidity_reports")
  const [countRow] = await query<any[]>(`SELECT COUNT(*) AS total FROM morbidity_reports ${count.whereSql}`, count.params)
  const itemsQ = filters("mr")
  const items = await query<any[]>(
    `SELECT mr.*, f.facility_name, u.full_name AS reporter_name
     FROM morbidity_reports mr
     LEFT JOIN facilities f ON f.facility_id = mr.facility_id
     LEFT JOIN users u ON u.user_id = mr.reported_by
     ${itemsQ.whereSql}
     ORDER BY mr.reported_at DESC LIMIT ? OFFSET ?`,
    [...itemsQ.params, pageSize, (page - 1) * pageSize],
  )
  res.json({ items, total: Number(countRow?.total ?? 0), page, pageSize })
})
