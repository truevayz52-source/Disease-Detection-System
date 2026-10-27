import { Router } from "../lib/router.js"
import { query } from "../db.js"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { writeAudit } from "../lib/audit.js"
import { SYNDROMES, type Syndrome } from "../lib/syndromes.js"
import { insertMorbidityReports, type MorbidityReportInput } from "./morbidity.js"
import { detectOutbreaksCoalesced } from "../lib/outbreak.js"

export const fhirRouter = Router()

// Patient-level FHIR data carries PII — restrict to clinical/analyst roles,
// consistent with /api/patients (executives get aggregates, not records).
const fhirReaders = requireRole("public_health_analyst", "pathologist")
const fhirWriters = requireRole("medical_officer", "public_health_analyst", "system_admin")

const MORBIDITY_CS = "http://mohcc.gov.zw/fhir/cs/morbidity"

// Death observations join the finalized autopsy cause (falling back to the
// preliminary ICD/clinical summary) and the facility for place of death.
const DEATH_SELECT = `SELECT dn.*, a.final_cause_of_death, f.facility_name
  FROM death_notifications dn
  LEFT JOIN autopsy_reports a ON a.notification_id = dn.notification_id
  JOIN facilities f ON f.facility_id = dn.facility_id`

// Patients gain deceasedDateTime from their latest linked notification.
const PATIENT_SELECT = `SELECT p.*,
  (SELECT MAX(dn.date_of_death) FROM death_notifications dn WHERE dn.patient_id = p.patient_id AND dn.status <> 'rejected') AS date_of_death
  FROM patients p`

/** Port of BIIMZim `signal_to_fhir_observation()` — signal → FHIR R4 Observation. */
function signalToFhirObservation(s: any) {
  return {
    resourceType: "Observation",
    id: `dds-obs-${s.signal_id}`,
    meta: {
      versionId: "1",
      lastUpdated: new Date(s.updated_at ?? s.reported_at).toISOString(),
      profile: ["http://mohcc.gov.zw/fhir/StructureDefinition/mortality-signal-observation"],
    },
    status: "final",
    category: [{
      coding: [{
        system: "http://terminology.hl7.org/CodeSystem/observation-category",
        code: "survey",
        display: "Survey",
      }],
    }],
    code: {
      coding: [{
        system: "http://loinc.org",
        code: "95544-3",
        display: "Mortality Surveillance Signal",
      }],
      text: s.title ?? "Mortality Signal",
    },
    subject: { display: "General Population" },
    effectiveDateTime: new Date(s.reported_at).toISOString(),
    issued: new Date(s.reported_at).toISOString(),
    performer: [{ display: s.facility_name ?? "Ministry of Health and Child Care Officer" }],
    valueString: s.description ?? s.title ?? "",
    component: [
      {
        code: { coding: [{ system: "http://mohcc.gov.zw/fhir/cs/mortality", code: "signal-type", display: "Signal Type" }] },
        valueString: s.signal_type,
      },
      {
        code: { coding: [{ system: "http://mohcc.gov.zw/fhir/cs/mortality", code: "risk-score", display: "Risk Score" }] },
        valueInteger: s.risk_score ?? 0,
      },
      {
        code: { coding: [{ system: "http://mohcc.gov.zw/fhir/cs/mortality", code: "workflow-stage", display: "Workflow Stage" }] },
        valueString: s.workflow_stage,
      },
    ],
  }
}

export function deathToFhirObservation(n: any) {
  const cause = n.final_cause_of_death ?? n.clinical_summary ?? n.preliminary_icd_code ?? ""
  return {
    resourceType: "Observation",
    id: `dds-death-${n.notification_id}`,
    meta: { versionId: "1", lastUpdated: new Date(n.updated_at ?? n.created_at).toISOString() },
    status: "final",
    category: [{
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs", display: "Vital Signs" }],
    }],
    code: { coding: [{ system: "http://loinc.org", code: "69453-9", display: "Cause of death" }], text: cause || "Death notification" },
    effectiveDateTime: new Date(n.date_of_death ?? n.created_at).toISOString(),
    valueString: cause,
    component: [
      {
        code: { coding: [{ system: "http://mohcc.gov.zw/fhir/cs/dds", code: "death-place", display: "Place of Death" }] },
        valueString: n.facility_name ?? "unknown",
      },
    ],
  }
}

fhirRouter.get("/metadata", requireAuth, (_req, res) => {
  res.json({
    resourceType: "CapabilityStatement",
    status: "active",
    date: new Date().toISOString(),
    kind: "instance",
    fhirVersion: "4.0.1",
    format: ["json"],
    implementation: { description: "Disease Detection System FHIR facade", url: "/api/fhir" },
    rest: [{
      mode: "server",
      resource: [
        { type: "Observation", interaction: [{ code: "read" }, { code: "search-type" }, { code: "create" }] },
        { type: "Patient", interaction: [{ code: "read" }, { code: "search-type" }] },
        { type: "Bundle", interaction: [{ code: "read" }, { code: "create" }] },
      ],
    }],
  })
})

fhirRouter.get("/Observation", requireAuth, fhirReaders, async (req, res) => {
  const signals = await query<any[]>(
    `SELECT s.*, f.facility_name FROM health_signals s LEFT JOIN facilities f ON f.facility_id = s.facility_id
     ORDER BY s.reported_at DESC LIMIT 100`,
  )
  const deaths = await query<any[]>(`${DEATH_SELECT} WHERE dn.status <> 'rejected' ORDER BY dn.created_at DESC LIMIT 100`)
  const entries = [
    ...signals.map((s) => ({ resource: signalToFhirObservation(s) })),
    ...deaths.map((d) => ({ resource: deathToFhirObservation(d) })),
  ]
  res.json({ resourceType: "Bundle", type: "searchset", total: entries.length, entry: entries })
})

fhirRouter.get("/Observation/:id", requireAuth, fhirReaders, async (req, res) => {
  const id = req.params.id
  if (id.startsWith("dds-obs-")) {
    const rows = await query<any[]>(
      `SELECT s.*, f.facility_name FROM health_signals s LEFT JOIN facilities f ON f.facility_id = s.facility_id WHERE s.signal_id = ?`,
      [id.slice(8)],
    )
    return rows[0] ? res.json(signalToFhirObservation(rows[0])) : res.status(404).json({ error: "Not found" })
  }
  if (id.startsWith("dds-death-")) {
    const rows = await query<any[]>(`${DEATH_SELECT} WHERE dn.status <> 'rejected' AND dn.notification_id = ?`, [id.slice(10)])
    return rows[0] ? res.json(deathToFhirObservation(rows[0])) : res.status(404).json({ error: "Not found" })
  }
  res.status(404).json({ error: "Not found" })
})

fhirRouter.get("/Patient", requireAuth, fhirReaders, async (_req, res) => {
  const patients = await query<any[]>(`${PATIENT_SELECT} ORDER BY p.created_at DESC LIMIT 100`)
  res.json({
    resourceType: "Bundle",
    type: "searchset",
    total: patients.length,
    entry: patients.map((p) => ({ resource: patientToFhir(p) })),
  })
})

fhirRouter.get("/Patient/:id", requireAuth, fhirReaders, async (req, res) => {
  const rows = await query<any[]>(`${PATIENT_SELECT} WHERE p.patient_id = ?`, [req.params.id])
  if (!rows[0]) return res.status(404).json({ error: "Not found" })
  res.json(patientToFhir(rows[0]))
})

export function patientToFhir(p: any) {
  return {
    resourceType: "Patient",
    id: p.patient_id,
    meta: { versionId: "1", lastUpdated: new Date(p.updated_at ?? p.created_at).toISOString() },
    identifier: [{ system: "http://mohcc.gov.zw/fhir/patient-id", value: p.patient_id }],
    gender: p.gender === "male" || p.gender === "female" ? p.gender : "unknown",
    deceasedBoolean: true,
    deceasedDateTime: p.date_of_death ? new Date(p.date_of_death).toISOString() : undefined,
  }
}

fhirRouter.get("/Bundle", requireAuth, fhirReaders, async (_req, res) => {
  const signals = await query<any[]>(
    `SELECT s.*, f.facility_name FROM health_signals s LEFT JOIN facilities f ON f.facility_id = s.facility_id
     ORDER BY s.reported_at DESC LIMIT 50`,
  )
  const patients = await query<any[]>(`${PATIENT_SELECT} ORDER BY p.created_at DESC LIMIT 50`)
  res.json({
    resourceType: "Bundle",
    type: "collection",
    entry: [
      ...signals.map((s) => ({ resource: signalToFhirObservation(s) })),
      ...patients.map((p) => ({ resource: patientToFhir(p) })),
    ],
  })
})

// ---------------------------------------------------------------------------
// Inbound morbidity feed — FHIR R4 Observations carrying aggregate syndromic
// case counts from facilities/HIS while patients are still alive. Structured
// fields travel as components on the mohcc morbidity code system; the minimal
// form is code.coding (syndrome) + valueInteger (count) + effectivePeriod +
// a district or facility-id component. Lands in morbidity_reports through the
// same ingest path as POST /api/morbidity.
// ---------------------------------------------------------------------------

const SEVERITIES = new Set(["low", "medium", "high", "critical"])

function componentValue(obs: any, code: string): any {
  const c = (obs?.component ?? []).find((x: any) =>
    (x.code?.coding ?? []).some((cd: any) => cd.code === code))
  return c?.valueString ?? c?.valueInteger ?? c?.valueQuantity?.value ?? c?.valueCodeableConcept?.text ?? null
}

function normalizeSyndrome(raw: any): Syndrome {
  const s = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")
  return (SYNDROMES as readonly string[]).includes(s) ? (s as Syndrome) : "other"
}

export function fhirObservationToMorbidity(obs: any): MorbidityReportInput | null {
  if (obs?.resourceType !== "Observation") return null
  const today = new Date().toISOString().slice(0, 10)
  const syndromeCoding = (obs.code?.coding ?? []).find((c: any) => c.system === MORBIDITY_CS)
  const syndrome = normalizeSyndrome(syndromeCoding?.code ?? componentValue(obs, "syndrome") ?? obs.code?.text)

  const caseCount = Number(obs.valueInteger ?? obs.valueQuantity?.value ?? componentValue(obs, "case-count") ?? 0)
  if (!Number.isInteger(caseCount) || caseCount < 1) return null

  const start = String(obs.effectivePeriod?.start ?? obs.effectiveDateTime ?? today).slice(0, 10)
  const end = String(obs.effectivePeriod?.end ?? obs.effectiveDateTime ?? start).slice(0, 10)
  const district = componentValue(obs, "district")
  const facilityId = componentValue(obs, "facility-id")
  if (!district && !facilityId) return null // unplaceable — refuse rather than mislocate

  const severity = String(componentValue(obs, "severity") ?? "medium")
  const idPart = obs.id ?? obs.identifier?.[0]?.value
  return {
    externalId: idPart ? `fhir:${idPart}` : undefined,
    facilityId: facilityId ?? undefined,
    district: district ?? "",
    province: componentValue(obs, "province") ?? undefined,
    syndrome,
    icdCode: componentValue(obs, "icd-code") ?? undefined,
    caseCount,
    periodStart: start,
    periodEnd: end,
    sourceChannel: "fhir",
    severity: (SEVERITIES.has(severity) ? severity : "medium") as MorbidityReportInput["severity"],
    notes: componentValue(obs, "notes") ?? obs.note?.[0]?.text ?? undefined,
  }
}

function operationOutcome(severity: string, code: string, diagnostics: string) {
  return { resourceType: "OperationOutcome", issue: [{ severity, code, diagnostics }] }
}

fhirRouter.post("/Observation", requireAuth, fhirWriters, async (req, res) => {
  const item = fhirObservationToMorbidity(req.body)
  if (!item) return res.status(400).json(operationOutcome("error", "invalid", "Observation lacks a usable syndrome, case count, or location (district/facility-id component)"))

  const result = await insertMorbidityReports([item], req.user!.userId)
  if ("error" in result) return res.status(400).json(operationOutcome("error", "invalid", result.error))

  await writeAudit(req, { action: "fhir_morbidity_ingested", entityType: "morbidity_reports", entityId: result.reportIds[0] ?? null })
  void detectOutbreaksCoalesced(undefined, true).catch(() => [])
  if (result.duplicates.length) {
    return res.status(200).json({ ...operationOutcome("information", "duplicate", "Already received"), reportId: result.duplicates[0] })
  }
  res.status(201).json({ reportIds: result.reportIds })
})

fhirRouter.post("/Bundle", requireAuth, fhirWriters, async (req, res) => {
  const entries = Array.isArray(req.body?.entry) ? req.body.entry : []
  const items = entries.map((e: any) => fhirObservationToMorbidity(e?.resource)).filter((i: any): i is MorbidityReportInput => !!i)
  if (!items.length) {
    return res.status(400).json(operationOutcome("error", "invalid", "Bundle contains no usable morbidity Observations"))
  }

  const result = await insertMorbidityReports(items, req.user!.userId)
  if ("error" in result) return res.status(400).json(operationOutcome("error", "invalid", result.error))

  await writeAudit(req, { action: "fhir_morbidity_bundle_ingested", entityType: "morbidity_reports", entityId: result.reportIds[0] ?? null, details: { inserted: result.reportIds.length } })
  void detectOutbreaksCoalesced(undefined, true).catch(() => [])
  res.status(201).json({ inserted: result.reportIds.length, reportIds: result.reportIds, skipped: entries.length - items.length, duplicates: result.duplicates })
})
