import test from "node:test"
import assert from "node:assert/strict"
import { patientToFhir, deathToFhirObservation } from "../src/routes/fhir.js"

// Regression: these mappers previously read p.sex / p.date_of_death and
// n.cause_of_death / n.place_of_death — none of which exist on the tables.

test("patientToFhir maps the real gender column and notification death date", () => {
  const r = patientToFhir({ patient_id: "p1", gender: "female", created_at: "2026-01-01T00:00:00Z", date_of_death: "2026-09-01T10:00:00Z" })
  assert.equal(r.resourceType, "Patient")
  assert.equal(r.gender, "female")
  assert.equal(r.deceasedBoolean, true)
  assert.equal(r.deceasedDateTime, new Date("2026-09-01T10:00:00Z").toISOString())
})

test("patientToFhir normalizes unknown gender and missing death date", () => {
  const r = patientToFhir({ patient_id: "p2", gender: "other", created_at: "2026-01-01T00:00:00Z", date_of_death: null })
  assert.equal(r.gender, "unknown")
  assert.equal(r.deceasedDateTime, undefined)
})

test("deathToFhirObservation prefers the finalized autopsy cause", () => {
  const r = deathToFhirObservation({
    notification_id: "n1", created_at: "2026-01-01T00:00:00Z", date_of_death: "2026-09-01T00:00:00Z",
    final_cause_of_death: "Cholera", clinical_summary: "ignored", facility_name: "Harare Central Hospital",
  })
  assert.equal(r.valueString, "Cholera")
  assert.equal(r.code.text, "Cholera")
  assert.equal(r.component[0].valueString, "Harare Central Hospital")
  assert.equal(r.effectiveDateTime, new Date("2026-09-01T00:00:00Z").toISOString())
})

test("deathToFhirObservation falls back to summary then ICD code", () => {
  const withSummary = deathToFhirObservation({ notification_id: "n2", created_at: "2026-01-01T00:00:00Z", clinical_summary: "sudden collapse" })
  assert.equal(withSummary.valueString, "sudden collapse")
  const icdOnly = deathToFhirObservation({ notification_id: "n3", created_at: "2026-01-01T00:00:00Z", preliminary_icd_code: "A00" })
  assert.equal(icdOnly.valueString, "A00")
  assert.equal(icdOnly.component[0].valueString, "unknown")
})
