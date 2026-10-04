import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { pathologyResult, serviceJson } from "../src/lib/integrations.js"

test("pathology responses reject invalid scores and regions outside the image", () => {
  const valid = {modelVersion:"test-v1",anomalyScore:0.2,confidenceScore:0.8,regions:[{x:0.1,y:0.2,width:0.4,height:0.3}]}
  assert(pathologyResult.safeParse(valid).success)
  assert(!pathologyResult.safeParse({...valid,anomalyScore:1.1}).success)
  assert(!pathologyResult.safeParse({...valid,regions:[{x:0.9,y:0,width:0.2,height:0.1}]}).success)
  assert(!pathologyResult.safeParse({...valid,modelVersion:""}).success)
})

test("service adapter handles success, errors, malformed JSON and redirects", async () => {
  let redirected = false
  const server = createServer((req,res) => {
    if(req.url === "/ok") {res.setHeader("content-type","application/json");res.end('{"text":"transcript"}')}
    else if(req.url === "/redirect") {res.writeHead(302,{location:"/target"});res.end()}
    else if(req.url === "/target") {redirected=true;res.end("{}")}
    else if(req.url === "/invalid") res.end("not JSON")
    else {res.writeHead(500);res.end("sensitive upstream error")}
  })
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve))
  const address=server.address() as {port:number},base=`http://127.0.0.1:${address.port}`
  try {
    assert.deepEqual(await serviceJson(base+"/ok"),{text:"transcript"})
    for(const route of ["/error","/invalid","/redirect"]) await assert.rejects(serviceJson(base+route),(error:any)=>error.status===503&&!error.message.includes("sensitive"))
    assert.equal(redirected,false)
  } finally {server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
})
