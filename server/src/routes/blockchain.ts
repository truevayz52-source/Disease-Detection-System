import crypto from "node:crypto"
import { Router } from "../lib/router.js"
import { requireAuth,requireRole } from "../auth/middleware.js"
import { query,newId,withAdvisoryLock } from "../db.js"
import { writeAudit,verifyAuditChain } from "../lib/audit.js"
export const blockchainRouter=Router()
blockchainRouter.use(requireAuth,requireRole("public_health_analyst","system_admin"))
const parse=(v:any)=>typeof v==="string"?JSON.parse(v):v
blockchainRouter.get("/chain",async(_req,res)=>res.json({kind:"local-hash-chain",items:await query('SELECT * FROM blockchain_audit ORDER BY "timestamp" DESC LIMIT 100')}))
blockchainRouter.post("/mine",requireRole("system_admin"),async(req,res)=>{
  const integrity=await verifyAuditChain()
  if(!integrity.valid)return res.status(409).json({error:"Audit integrity must be valid before creating a snapshot"})
  const result=await withAdvisoryLock("dds_snapshot_chain",10,async(conn)=>{
    const [blocks]=await conn.query<any[]>("SELECT block_hash,previous_hash FROM blockchain_audit")
    const referenced=new Set(blocks.map(b=>b.previous_hash)),tail=blocks.find(b=>!referenced.has(b.block_hash)),previous=tail?.block_hash??"genesis"
    const [audit]=await conn.query<any[]>("SELECT record_hash,chain_sequence FROM audit_log ORDER BY chain_sequence DESC LIMIT 1")
    const id=newId("blk"),data=JSON.stringify({blockId:id,auditHead:audit[0]?.record_hash??null,sequence:audit[0]?.chain_sequence??0,createdAt:new Date().toISOString()})
    const hash=crypto.createHash("sha256").update(previous+data).digest("hex")
    await conn.query("INSERT INTO blockchain_audit (block_id,previous_hash,block_hash,audit_data,mined_by) VALUES (?,?,?,?,?)",[id,previous,hash,data,req.user!.userId])
    return {id,hash}
  })
  if(!result.acquired)throw Error("Snapshot writer busy")
  await writeAudit(req,{action:"snapshot_audit",entityType:"blockchain_audit",entityId:result.value.id});res.status(201).json(result.value)
})
blockchainRouter.get("/verify",async(_req,res)=>{
  const blocks=await query<any[]>("SELECT * FROM blockchain_audit"),byPrevious=new Map<string,any[]>();let previous="genesis",checked=0
  for(const b of blocks)byPrevious.set(b.previous_hash,[...(byPrevious.get(b.previous_hash)??[]),b])
  while(byPrevious.has(previous)){
    const next:any[]=byPrevious.get(previous)!
    if(next.length!==1||checked>=blocks.length)return res.json({valid:false,checked})
    const b=next[0],hash=crypto.createHash("sha256").update(previous+JSON.stringify(parse(b.audit_data))).digest("hex")
    if(hash!==b.block_hash)return res.json({valid:false,checked,brokenAt:b.block_id})
    previous=hash;checked++
  }
  res.json({valid:checked===blocks.length,checked,audit:await verifyAuditChain()})
})
