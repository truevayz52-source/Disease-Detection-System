import { Router } from "../lib/router.js"
import { z } from "zod"
import { newId, query } from "../db.js"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { writeAudit } from "../lib/audit.js"
import { scopeWhere } from "../lib/scope.js"
import { analyzeText } from "../lib/classifier.js"

const DEFAULT_RESPONSE_HOURS = 72
const CRITICAL_RESPONSE_HOURS = 24
const MATERNAL_RESPONSE_HOURS = 48

export const signalsRouter = Router()

const signalRoles = ["medical_officer", "mortuary_clerk", "public_health_analyst"] as const
const triageRoles = ["public_health_analyst"] as const

const createSchema = z.object({
  externalId: z.string().max(128).optional(),
  // Mortality-aligned signal taxonomy: unreported community deaths, deaths
  // needing medico-legal attention, MPDSR candidates and death clusters —
  // plus illness_cluster for pre-mortality syndromic reports (rumours of a
  // disease cluster in the community before any death occurs).
  signalType: z.enum(["unreported_death", "suspicious_death", "maternal_perinatal", "death_cluster", "community_alert", "illness_cluster"]).default("unreported_death"),
  title: z.string().min(2).max(255),
  description: z.string().max(8000).optional(),
  sourceChannel: z.enum(["community", "vhw", "facility", "police", "media", "offline"]).default("community"),
  district: z.string().max(100).optional(),
  province: z.string().max(100).optional(),
  facilityId: z.string().max(36).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
})

signalsRouter.get("/", requireAuth, requireRole(...signalRoles), async (req, res) => {
  const { status, district, signalType } = req.query as Record<string, string | undefined>
  const params: any[] = []
  let whereSql = "WHERE 1=1"
  const scope = scopeWhere(req.user!, "s")
  if (scope.where) { whereSql += ` AND (${scope.where})`; params.push(...scope.params) }
  if (status) { whereSql += " AND s.status = ?"; params.push(status) }
  if (district) { whereSql += " AND s.district = ?"; params.push(district) }
  if (signalType) { whereSql += " AND s.signal_type = ?"; params.push(signalType) }
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 200))
  const [countRow] = await query<any[]>(
    `SELECT COUNT(*) AS total FROM health_signals s ${whereSql}`,
    params,
  )
  const items = await query<any[]>(
    `SELECT s.*, f.facility_name, u.full_name AS reporter_name, a.full_name AS assignee_name,
            (s.sla_due_at IS NOT NULL AND s.sla_due_at < NOW() AND s.status NOT IN ('resolved','dismissed')) AS overdue
     FROM health_signals s
     LEFT JOIN facilities f ON f.facility_id = s.facility_id
     LEFT JOIN users u ON u.user_id = s.reported_by
     LEFT JOIN users a ON a.user_id = s.assigned_to
     ${whereSql}
     ORDER BY s.reported_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  res.json({ items, total: Number(countRow?.total ?? 0), page, pageSize })
})

signalsRouter.post("/", requireAuth, requireRole(...signalRoles), async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid signal data" })
  const d = parsed.data

  if (d.externalId) {
    const dup = await query<any[]>("SELECT signal_id FROM health_signals WHERE external_id = ?", [d.externalId])
    if (dup[0]) return res.status(409).json({ error: "Duplicate signal", signalId: dup[0].signal_id })
  }

  const id = newId("sig")
  const analysis = analyzeText(`${d.title} ${d.description ?? ""}`)
  const slaHours =
    d.severity === "critical" || d.signalType === "suspicious_death"
      ? CRITICAL_RESPONSE_HOURS
      : d.signalType === "maternal_perinatal"
        ? MATERNAL_RESPONSE_HOURS
        : DEFAULT_RESPONSE_HOURS
  await query(
    `INSERT INTO health_signals
     (signal_id, external_id, signal_type, title, description, source_channel, district, province, facility_id, severity, reported_by, sla_due_at, risk_score, classified_topics, sentiment, classified_drivers)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW() + (? * INTERVAL '1 hour'), ?, ?, ?, ?)`,
    [id, d.externalId ?? null, d.signalType, d.title, d.description ?? null, d.sourceChannel,
     d.district ?? null, d.province ?? null, d.facilityId ?? null, d.severity, req.user!.userId,
     slaHours, analysis.riskScore, analysis.topics.join(","), analysis.sentiment, analysis.drivers.join(",")],
  )
  await query(
    `INSERT INTO signal_workflow_events (event_id, signal_id, to_stage, to_status, actor_id, actor_name, notes)
     VALUES (?, ?, 'captured', 'new', ?, ?, 'Signal captured')`,
    [newId("swe"), id, req.user!.userId, req.user!.name],
  )
  await writeAudit(req, { action: "signal_created", entityType: "health_signals", entityId: id, details: { type: d.signalType } })
  res.status(201).json({ signalId: id, riskScore: analysis.riskScore, recommendedResponses: analysis.recommendedResponses })
})

const workflowSchema = z.object({
  // stage optional so callers can attach evidence/links without moving
  // the signal backwards through its lifecycle.
  stage: z.enum(["captured", "verified", "escalated", "closed"]).optional(),
  status: z.enum(["new", "triaged", "investigating", "resolved", "dismissed"]).optional(),
  evidence: z.string().max(8000).optional(),
  actionTaken: z.string().max(8000).optional(),
  outcome: z.string().max(8000).optional(),
  assignedTo: z.string().max(36).optional(),
  linkedNotificationId: z.string().max(36).optional(),
  linkedAlertId: z.string().max(36).optional(),
  notes: z.string().max(2000).optional(),
})

signalsRouter.patch("/:id/workflow", requireAuth, requireRole(...triageRoles), async (req, res) => {
  const parsed = workflowSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid workflow data" })
  const d = parsed.data

  const rows = await query<any[]>("SELECT * FROM health_signals WHERE signal_id = ?", [req.params.id])
  const signal = rows[0]
  if (!signal) return res.status(404).json({ error: "Signal not found" })

  const nextStage = d.stage ?? signal.workflow_stage
  const nextStatus = d.status ?? signal.status
  await query(
    `UPDATE health_signals SET workflow_stage = ?, status = ?,
       evidence = COALESCE(?, evidence), action_taken = COALESCE(?, action_taken),
       outcome = COALESCE(?, outcome), assigned_to = COALESCE(?, assigned_to),
       linked_notification_id = COALESCE(?, linked_notification_id),
       linked_alert_id = COALESCE(?, linked_alert_id)
     WHERE signal_id = ?`,
    [nextStage, nextStatus, d.evidence ?? null, d.actionTaken ?? null, d.outcome ?? null,
     d.assignedTo ?? null, d.linkedNotificationId ?? null, d.linkedAlertId ?? null, signal.signal_id],
  )
  // Escalating a suspicious death opens a medico-legal case investigation
  // (idempotent — one investigation per signal).
  if (d.stage === "escalated" && signal.signal_type === "suspicious_death" && signal.workflow_stage !== "escalated") {
    const existing = await query<any[]>("SELECT investigation_id FROM case_investigations WHERE linked_signal_id = ?", [signal.signal_id])
    if (!existing.length) {
      await query(
        `INSERT INTO case_investigations (investigation_id, linked_signal_id, linked_notification_id, linked_alert_id, title, status, lead_investigator)
         VALUES (?, ?, ?, ?, ?, 'open', ?)`,
        [newId("inv"), signal.signal_id, signal.linked_notification_id, signal.linked_alert_id,
         `Investigation: ${signal.title}`, req.user!.userId],
      )
    }
  }
  await query(
    `INSERT INTO signal_workflow_events
     (event_id, signal_id, from_stage, to_stage, from_status, to_status, actor_id, actor_name, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId("swe"), signal.signal_id, signal.workflow_stage, nextStage, signal.status, nextStatus,
     req.user!.userId, req.user!.name, d.notes ?? null],
  )
  await writeAudit(req, { action: "signal_workflow", entityType: "health_signals", entityId: signal.signal_id, details: { stage: nextStage, status: nextStatus } })
  res.json({ ok: true })
})

signalsRouter.post("/:id/playbook", requireAuth, requireRole(...triageRoles), async (req, res) => {
  const parsed = z.object({ playbookId: z.string().max(36) }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "Invalid playbook reference" })

  const [signal] = await query<any[]>("SELECT signal_id, workflow_stage, status FROM health_signals WHERE signal_id = ?", [req.params.id])
  if (!signal) return res.status(404).json({ error: "Signal not found" })
  const [playbook] = await query<any[]>("SELECT * FROM response_playbooks WHERE playbook_id = ?", [parsed.data.playbookId])
  if (!playbook) return res.status(404).json({ error: "Playbook not found" })

  await query(
    "INSERT INTO signal_playbook_links (signal_id, playbook_id, attached_by) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    [signal.signal_id, playbook.playbook_id, req.user!.userId],
  )
  await query(
    `INSERT INTO signal_workflow_events (event_id, signal_id, from_stage, to_stage, from_status, to_status, actor_id, actor_name, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId("swe"), signal.signal_id, signal.workflow_stage, signal.workflow_stage, signal.status, signal.status,
     req.user!.userId, req.user!.name, `Playbook attached: ${playbook.name}`],
  )
  await writeAudit(req, { action: "signal_playbook_attached", entityType: "health_signals", entityId: signal.signal_id, details: { playbook: playbook.name } })
  res.json({ ok: true, steps: typeof playbook.steps === "string" ? JSON.parse(playbook.steps) : playbook.steps ?? [] })
})

signalsRouter.get("/:id/history", requireAuth, requireRole(...signalRoles), async (req, res) => {
  const events = await query<any[]>(
    "SELECT * FROM signal_workflow_events WHERE signal_id = ? ORDER BY created_at ASC",
    [req.params.id],
  )
  res.json({ items: events })
})
