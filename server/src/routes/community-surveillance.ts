import { Router } from "../lib/router.js"
import { z } from "zod"
import crypto from "node:crypto"
import { requireAuth, requireRole, rateLimiter } from "../auth/middleware.js"
import { newId, query } from "../db.js"
import { writeAudit } from "../lib/audit.js"
import { scopeWhere } from "../lib/scope.js"
import { analyzeText } from "../lib/classifier.js"
import { config } from "../config.js"

export const communitySurveillanceRouter = Router()

/**
 * Optional shared-secret gate for the public report channel. When
 * COMMUNITY_API_KEY is set, callers must send it as x-api-key; unset keeps
 * the endpoint open for local development and demos.
 */
export function communityApiKey(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  if (!config.communityApiKey) return next()
  const provided = String(req.headers["x-api-key"] ?? "")
  const expected = config.communityApiKey
  const ok = provided.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  if (!ok) return res.status(401).json({ error: "Invalid or missing API key" })
  next()
}

// Submit community report via USSD/WhatsApp — public by design, but throttled
// and optionally key-gated so the write path can't be flooded anonymously.
communitySurveillanceRouter.post("/report", communityApiKey, rateLimiter(20), async (req, res) => {
  const schema = z.object({
    reporterPhone: z.string(),
    reportType: z.enum(["mortality_spike", "unusual_disease", "outbreak_suspected"]),
    locationName: z.string(),
    district: z.string(),
    province: z.string(),
    reportMessage: z.string(),
    estimatedCases: z.number().optional(),
    severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid report data" })
  
  const { reporterPhone, reportType, locationName, district, province, reportMessage, estimatedCases, severity } = parsed.data
  
  const reportId = crypto.randomUUID()
  const analysis = analyzeText(`${reportType} ${locationName} ${reportMessage}`)
  await query(
    `INSERT INTO community_reports (report_id, reporter_phone, report_type, location_name, district, province, report_message, estimated_cases, severity, risk_score, classified_topics, sentiment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [reportId, reporterPhone, reportType, locationName, district, province, reportMessage, estimatedCases || null, severity, analysis.riskScore, analysis.topics.join(","), analysis.sentiment]
  )
  
  res.status(201).json({ reportId, message: "Report submitted successfully" })
})

// Get community reports (for verification)
communitySurveillanceRouter.get("/", requireAuth, requireRole("public_health_analyst"), async (req, res) => {
  const district = req.query.district as string
  const verified = req.query.verified as string
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 100))

  let where = "WHERE 1=1"
  const params: any[] = []

  const scope = scopeWhere(req.user!, "community_reports")
  if (scope.where) { where += ` AND (${scope.where})`; params.push(...scope.params) }

  if (district) {
    where += " AND district = ?"
    params.push(district)
  }

  if (verified === "true" || verified === "false") {
    where += " AND verified = ?"
    params.push(verified === "true")
  }

  const [countRow] = await query<any[]>(`SELECT COUNT(*) AS total FROM community_reports ${where}`, params)
  const reports = await query<any[]>(
    `SELECT * FROM community_reports ${where} ORDER BY reported_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    params,
  )
  res.json({ items: reports, total: Number(countRow?.total ?? 0), page, pageSize })
})

// Verify community report
communitySurveillanceRouter.patch("/:reportId/verify", requireAuth, requireRole("public_health_analyst"), async (req, res) => {
  const schema = z.object({
    verified: z.boolean(),
    verificationNotes: z.string().optional(),
  })
  
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid verification data" })
  
  const { verified, verificationNotes } = parsed.data
  
  await query(
    `UPDATE community_reports 
     SET verified = ?, verified_by = ?, verification_notes = ?
     WHERE report_id = ?`,
    [verified, req.user!.userId, verificationNotes || null, req.params.reportId]
  )

  // A verified community report is a real mortality signal — promote it into
  // the signal registry (already verified, so it lands at verified/triaged).
  // external_id dedupes repeat verifications of the same report.
  let promotedSignalId: string | null = null
  if (verified) {
    const externalId = `crp:${req.params.reportId}`
    const [report, dup] = await Promise.all([
      query<any[]>("SELECT * FROM community_reports WHERE report_id = ?", [req.params.reportId]),
      query<any[]>("SELECT signal_id FROM health_signals WHERE external_id = ?", [externalId]),
    ])
    if (report[0] && !dup.length) {
      const r = report[0]
      const typeMap: Record<string, string> = {
        mortality_spike: "death_cluster",
        outbreak_suspected: "death_cluster",
        unusual_disease: "community_alert",
      }
      promotedSignalId = newId("sig")
      await query(
        `INSERT INTO health_signals
         (signal_id, external_id, signal_type, title, description, source_channel, district, province, severity, status, workflow_stage, reported_by, sla_due_at, risk_score, classified_topics, sentiment)
         VALUES (?, ?, ?, ?, ?, 'community', ?, ?, ?, 'triaged', 'verified', ?, NOW() + (? * INTERVAL '1 hour'), ?, ?, ?)`,
        [
          promotedSignalId, externalId, typeMap[r.report_type] ?? "community_alert",
          `Community report: ${r.location_name ?? r.district ?? "unspecified location"}`,
          r.report_message ?? null, r.district ?? null, r.province ?? null,
          r.severity ?? "medium", req.user!.userId,
          r.severity === "critical" ? 24 : 72,
          r.risk_score ?? null, r.classified_topics ?? null, r.sentiment ?? null,
        ],
      )
      await query(
        `INSERT INTO signal_workflow_events (event_id, signal_id, to_stage, to_status, actor_id, actor_name, notes)
         VALUES (?, ?, 'verified', 'triaged', ?, ?, ?)`,
        [newId("swe"), promotedSignalId, req.user!.userId, req.user!.name,
         `Promoted from community report ${req.params.reportId}`],
      )
      await query(
        "UPDATE community_reports SET linked_signal_id = ? WHERE report_id = ?",
        [promotedSignalId, req.params.reportId],
      )
      await query("UPDATE community_reports SET linked_signal_id = ? WHERE report_id = ?", [promotedSignalId, req.params.reportId])
    } else if (dup.length) {
      promotedSignalId = dup[0].signal_id
    }
  }

  await writeAudit(req, { action: "verify_community_report", entityType: "community_reports", entityId: req.params.reportId, details: { verified, promotedSignalId } })
  res.json({ ok: true, signalId: promotedSignalId })
})
