// Uses synthetic speech only. Does not save a transcript or alter a case.
import { readFile } from "node:fs/promises"
import assert from "node:assert/strict"
const base="http://localhost:4000/api"
const login=await fetch(`${base}/auth/login`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"sysadmin@mohcc.org.zw",password:"password123"})})
assert.equal(login.status,200)
const {token}=await login.json() as {token:string}
const headers={authorization:`Bearer ${token}`}
try {
  const cases=await (await fetch(`${base}/notifications`,{headers})).json() as {items:{notification_id:string}[]}
  assert(cases.items.length,"An existing demo case is required")
  const body=new FormData()
  body.append("notificationId",cases.items[0].notification_id)
  body.append("language","en")
  body.append("file",new Blob([new Uint8Array(await readFile(new URL("../../analytics/test-audio.wav",import.meta.url)))],{type:"audio/wav"}),"synthetic-test.wav")
  const result=await fetch(`${base}/voice/transcribe`,{method:"POST",headers,body})
  const value=await result.json() as {text?:string;error?:string}
  assert.equal(result.status,200,JSON.stringify(value))
  assert.match(value.text||"",/disease detection system/i)
  console.log("PASS authenticated audio upload and local speech transcription:",value.text)
} finally {await fetch(`${base}/auth/logout`,{method:"POST",headers})}
