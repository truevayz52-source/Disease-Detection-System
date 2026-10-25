import { describe, it } from "node:test"
import assert from "node:assert"
import { canTransition, isTerminal, CASE_STATUSES } from "../src/lib/case-workflow.js"
import { signReport, verifyReport, canonicalStringify } from "../src/lib/signature.js"

describe("case-workflow", () => {
  it("defines the full status set", () => {
    assert.deepStrictEqual(CASE_STATUSES, [
      "pending_review",
      "under_review",
      "autopsy_complete",
      "certified",
      "finalized",
      "rejected",
    ])
  })

  it("only allows legal transitions", () => {
    assert.strictEqual(canTransition("pending_review", "under_review"), true)
    assert.strictEqual(canTransition("pending_review", "autopsy_complete"), true)
    assert.strictEqual(canTransition("pending_review", "certified"), true)
    assert.strictEqual(canTransition("pending_review", "rejected"), true)
    assert.strictEqual(canTransition("under_review", "autopsy_complete"), true)
    assert.strictEqual(canTransition("under_review", "certified"), true)
    assert.strictEqual(canTransition("under_review", "rejected"), true)
    assert.strictEqual(canTransition("autopsy_complete", "finalized"), true)
    assert.strictEqual(canTransition("pending_review", "finalized"), false)
    assert.strictEqual(canTransition("under_review", "pending_review"), false)
    assert.strictEqual(canTransition("rejected", "under_review"), false)
    assert.strictEqual(canTransition("certified", "finalized"), false)
    assert.strictEqual(canTransition("finalized", "rejected"), false)
  })

  it("marks certified, finalized and rejected as terminal", () => {
    for (const s of ["certified", "finalized", "rejected"] as const) {
      assert.strictEqual(isTerminal(s), true)
    }
    for (const s of ["pending_review", "under_review", "autopsy_complete"] as const) {
      assert.strictEqual(isTerminal(s), false)
    }
  })
})

describe("signature", () => {
  const secret = "dev-test-secret-hex"

  it("produces deterministic canonical JSON", () => {
    assert.strictEqual(canonicalStringify({ b: 2, a: 1 }), `{"a":1,"b":2}`)
    assert.strictEqual(canonicalStringify([{ z: 1, a: 2 }]), `[{"a":2,"z":1}]`)
  })

  it("signs and verifies a report", () => {
    const payload = { type: "autopsy_report", autopsyId: "aut-1", notificationId: "dn-1", finalIcdCode: "I64" }
    const hmac = signReport(payload, secret)
    assert.strictEqual(hmac.length, 64)
    assert.strictEqual(verifyReport(payload, hmac, secret).valid, true)
  })

  it("rejects a tampered payload or signature", () => {
    const payload = { type: "certification", certificationId: "mcc-1" }
    const hmac = signReport(payload, secret)
    assert.strictEqual(verifyReport({ ...payload, certificationId: "mcc-2" }, hmac, secret).valid, false)
    assert.strictEqual(verifyReport(payload, hmac.slice(0, -1) + (hmac.slice(-1) === "0" ? "1" : "0"), secret).valid, false)
  })

  it("reports unsigned for missing hmac", () => {
    const payload = { type: "autopsy_report", autopsyId: "aut-1" }
    const { valid, reason } = verifyReport(payload, null, secret)
    assert.strictEqual(valid, false)
    assert.strictEqual(reason, "unsigned")
  })
})
