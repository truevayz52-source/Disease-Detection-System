import { Router } from "../lib/router.js"
import { query } from "../db.js"
import { requireAuth, requireRole } from "../auth/middleware.js"

export const fhirRouter = Router()

// Patient-level FHIR data carries PII — restrict to clinical/analyst roles,
// consistent with /api/patients (executives get aggregates, not records).
const fhirReaders = requireRole("public_health_analyst", "pathologist", "system_admin")

// Death observations join the finalized autopsy cause (falling back to the
// preliminary ICD/clinical summary) and the facility for place of death.
const DEATH_SELECT = `SELECT dn.*, a.final_cause_of_death, f.facility_name
  FROM death_notifications dn
  LEFT JOIN autopsy_reports a ON a.notification_id = dn.notification_id
  JOIN facilities f ON f.facility_id = dn.facility_id`

// Patients gain deceasedDateTime from their latest linked notification.
const PATIENT_SELECT = `SELECT p.*,
  (SELECT MAX(dn.date_of_death) FROM death_notifications dn WHERE dn.patient_id = p.patient_id) AS date_of_death
  FROM patients p`

/** Port of BIIMZim `signal_to_fhir_observation()` — signal → FHIR R4 Observation. */
function signalToFhirObservation(s: any) {
  return {
    resourceType: "Observation",
    id: `dds-obs-${s.signal_id}`,
    meta: {
      versionId: "1",
      lastUpdated: new Date(s.updated_at ?? s.reported_at).toISOString(),
      profile: ["http://mohcc.gov.zw/fhir/StructureDefinition/biim-signal-observation"],
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
        display: "Public Health Behavioural Intelligence Signal",
      }],
      text: s.title ?? "Community Signal",
    },
    subject: { display: "General Population" },
    effectiveDateTime: new Date(s.reported_at).toISOString(),
    issued: new Date(s.reported_at).toISOString(),
    performer: [{ display: s.facility_name ?? "Ministry of Health and Child Care Officer" }],
    valueString: s.description ?? s.title ?? "",
    component: [
      {
        code: { coding: [{ system: "http://mohcc.gov.zw/fhir/cs/biim", code: "signal-type", display: "Signal Type" }] },
        valueString: s.signal_type,
      },
      {
        code: { coding: [{ system: "http://mohcc.gov.zw/fhir/cs/biim", code: "risk-score", display: "Risk Score" }] },
        valueInteger: s.risk_score ?? 0,
      },
      {
        code: { coding: [{ system: "http://mohcc.gov.zw/fhir/cs/biim", code: "workflow-stage", display: "Workflow Stage" }] },
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
        { type: "Observation", interaction: [{ code: "read" }, { code: "search-type" }] },
        { type: "Patient", interaction: [{ code: "read" }, { code: "search-type" }] },
        { type: "Bundle", interaction: [{ code: "read" }] },
      ],
    }],
  })
})

fhirRouter.get("/Observation", requireAuth, fhirReaders, async (req, res) => {
  const signals = await query<any[]>(
    `SELECT s.*, f.facility_name FROM health_signals s LEFT JOIN facilities f ON f.facility_id = s.facility_id
     ORDER BY s.reported_at DESC LIMIT 100`,
  )
  const deaths = await query<any[]>(`${DEATH_SELECT} ORDER BY dn.created_at DESC LIMIT 100`)
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
    const rows = await query<any[]>(`${DEATH_SELECT} WHERE dn.notification_id = ?`, [id.slice(10)])
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
