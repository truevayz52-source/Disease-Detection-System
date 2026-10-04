import test from "node:test"
import assert from "node:assert/strict"
import { sniffImageType } from "../src/routes/images.js"
import { communityApiKey } from "../src/routes/community-surveillance.js"
import { detectOutbreaksCoalesced } from "../src/lib/outbreak.js"
import { config } from "../src/config.js"

test("sniffImageType accepts real image magic bytes", () => {
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0])), "image/jpeg")
  assert.equal(sniffImageType(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)])), "image/png")
  assert.equal(sniffImageType(Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 ", "latin1")), "image/webp")
  assert.equal(sniffImageType(Buffer.from([0x49, 0x49, 0x2a, 0x00])), "image/tiff")
  assert.equal(sniffImageType(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])), "image/tiff")
})

test("sniffImageType rejects executables and markup masquerading as images", () => {
  assert.equal(sniffImageType(Buffer.from("MZ\x90\x00\x03", "latin1")), null)
  assert.equal(sniffImageType(Buffer.from("<html><body>")), null)
  assert.equal(sniffImageType(Buffer.alloc(0)), null)
  assert.equal(sniffImageType(Buffer.from("%PDF-1.7")), null)
})

function mockReqRes(headers: Record<string, string>) {
  let status = 0
  const req = { headers } as any
  const res = { status(s: number) { status = s; return this }, json(_b: any) { return this } } as any
  return { req, res, getStatus: () => status }
}

test("communityApiKey passes through when no key is configured", () => {
  const prev = config.communityApiKey
  try {
    config.communityApiKey = null
    let called = false
    const { req, res } = mockReqRes({})
    communityApiKey(req, res, () => { called = true })
    assert.equal(called, true)
  } finally { config.communityApiKey = prev }
})

test("communityApiKey enforces a timing-safe key check when configured", () => {
  const prev = config.communityApiKey
  try {
    config.communityApiKey = "test-gateway-key"
    let called = false
    const missing = mockReqRes({})
    communityApiKey(missing.req, missing.res, () => { called = true })
    assert.equal(called, false)
    assert.equal(missing.getStatus(), 401)

    const wrong = mockReqRes({ "x-api-key": "nope" })
    communityApiKey(wrong.req, wrong.res, () => { called = true })
    assert.equal(called, false)
    assert.equal(wrong.getStatus(), 401)

    const ok = mockReqRes({ "x-api-key": "test-gateway-key" })
    communityApiKey(ok.req, ok.res, () => { called = true })
    assert.equal(called, true)
  } finally { config.communityApiKey = prev }
})

test("detectOutbreaksCoalesced folds burst calls into one trailing run", async () => {
  // First call executes immediately (may reject without a DB — that's fine).
  const first = detectOutbreaksCoalesced().catch(() => [])
  // Calls inside the cooldown resolve [] and schedule at most one trailing run.
  assert.deepEqual(await detectOutbreaksCoalesced(), [])
  assert.deepEqual(await detectOutbreaksCoalesced(), [])
  await first
})
