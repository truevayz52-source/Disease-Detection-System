import test from "node:test"
import assert from "node:assert/strict"
import { base32,decode32,totp,encryptSecret,decryptSecret } from "../src/auth/totp.js"
import { csvCell } from "../src/routes/reports.js"

test("TOTP matches all RFC 6238 SHA1 test vectors",()=>{
  const secret=base32(Buffer.from("12345678901234567890"))
  for(const [seconds,code] of [[59,"94287082"],[1111111109,"07081804"],[1111111111,"14050471"],[1234567890,"89005924"],[2000000000,"69279037"],[20000000000,"65353130"]] as const)assert.equal(totp(secret,Math.floor(seconds/30),8),code)
})
test("base32 round trip and authenticated secret encryption",()=>{
  const raw=Buffer.from("DDS authenticator secret");assert.deepEqual(decode32(base32(raw)),raw)
  const encrypted=encryptSecret(base32(raw));assert.equal(decryptSecret(encrypted),base32(raw));assert.notEqual(encrypted,base32(raw))
  const parts=encrypted.split(".");parts[2]=Buffer.from("altered ciphertext").toString("base64");assert.throws(()=>decryptSecret(parts.join(".")))
})
test("CSV export neutralizes spreadsheet formula injection",()=>{
  assert.equal(csvCell('=HYPERLINK("bad")'),'"\'=HYPERLINK(""bad"")"')
  assert.equal(csvCell(' \t+1'),'"\' \t+1"')
  assert.equal(csvCell('Harare, Central'),'"Harare, Central"')
})
