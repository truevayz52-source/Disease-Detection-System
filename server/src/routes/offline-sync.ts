import { Router } from "../lib/router.js"
import { requireAuth,requireRole } from "../auth/middleware.js"
import { createNotification } from "../lib/notification-service.js"
import { z } from "zod"
export const offlineRouter=Router()
offlineRouter.use(requireAuth,requireRole("medical_officer","mortuary_clerk","system_admin"))
offlineRouter.post("/sync",async(req,res)=>{
  const {items}=z.object({items:z.array(z.object({id:z.string().uuid(),payload:z.record(z.string(),z.unknown())})).max(20)}).parse(req.body)
  const results=[]
  for(const item of items){
    try { results.push({id:item.id,status:"synced",...await createNotification(req,{...item.payload,submissionId:item.id})}) }
    catch(error:any){results.push({id:item.id,status:error.status===409?"conflict":"failed",error:error instanceof z.ZodError?"Invalid notification data":error.status?error.message:"Unable to save record",retryable:!(error instanceof z.ZodError)&&(!error.status||error.status>=500)})}
  }
  res.json({results})
})
