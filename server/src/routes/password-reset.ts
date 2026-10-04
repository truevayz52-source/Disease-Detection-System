import crypto from "node:crypto"
import { z } from "zod"
import { Router } from "../lib/router.js"
import { rateLimiter } from "../auth/middleware.js"
import { hashPassword } from "../auth/password.js"
import { consumeCode,backupHash } from "../auth/totp.js"
import { query,getPool,newId } from "../db.js"
import { config } from "../config.js"
import { writeAudit } from "../lib/audit.js"
import { emailConfigured, sendEmail } from "../lib/email.js"
export const passwordResetRouter=Router()
passwordResetRouter.post("/request-password-reset",rateLimiter(5,15*60000),async(req,res)=>{
  const {email}=z.object({email:z.string().email().max(255)}).parse(req.body)
  const webhook=process.env.PASSWORD_RESET_WEBHOOK_URL
  if(!webhook&&!emailConfigured())return res.status(503).json({error:"Password reset delivery is not configured. Contact your system administrator."})
  const [user]=await query<any[]>("SELECT user_id,email FROM users WHERE email=? AND status='active'",[email.toLowerCase()])
  if(user){
    const token=crypto.randomBytes(32).toString("hex"),id=newId("reset")
    await query("INSERT INTO password_reset_tokens (token_id,user_id,token_hash,expires_at) VALUES (?,?,?,DATE_ADD(NOW(),INTERVAL 30 MINUTE))",[id,user.user_id,backupHash(token)])
    try{
      if(emailConfigured()) {
        await sendEmail(user.email,"Reset your Disease Detection System password",`Open ${config.clientOrigin}/reset-password#${token} to reset your password. This link expires in 30 minutes. If you did not request this, ignore this message.`)
      } else {
      const response=await fetch(webhook!,{method:"POST",redirect:"error",headers:{"content-type":"application/json",authorization:`Bearer ${process.env.PASSWORD_RESET_WEBHOOK_SECRET||""}`},body:JSON.stringify({to:user.email,template:"password_reset",url:`${config.clientOrigin}/reset-password#${token}`,expiresInMinutes:30}),signal:AbortSignal.timeout(5000)})
      if(!response.ok)throw Error("Delivery failed")
      }
    }catch{
      await query("UPDATE password_reset_tokens SET used=1 WHERE token_id=?",[id])
      // Keep the public response identical to an unknown account.
      console.error("[password-reset] delivery failed; token invalidated")
    }
  }
  res.status(202).json({ok:true,message:"If this active account exists, a reset link will be sent."})
})
passwordResetRouter.post("/reset-password",rateLimiter(10,15*60000),async(req,res)=>{
  const d=z.object({token:z.string().regex(/^[a-f0-9]{64}$/),newPassword:z.string().min(8).max(256).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),code:z.string().max(32).optional()}).parse(req.body)
  const connection=await getPool().getConnection()
  try{
    await connection.beginTransaction()
    const [tokens]=await connection.query<any[]>("SELECT * FROM password_reset_tokens WHERE token_hash=? AND used=0 AND expires_at>NOW() FOR UPDATE",[backupHash(d.token)])
    if(!tokens[0])return res.status(400).json({error:"Invalid or expired reset link"})
    const [tfa]=await query<any[]>("SELECT enabled FROM two_factor_auth WHERE user_id=?",[tokens[0].user_id])
    if(tfa?.enabled&&!await consumeCode(tokens[0].user_id,d.code||""))return res.status(400).json({error:"Authenticator or recovery code required"})
    await connection.query("UPDATE users SET password_hash=?,failed_login_attempts=0,locked_until=NULL WHERE user_id=?",[await hashPassword(d.newPassword),tokens[0].user_id])
    await connection.query("UPDATE password_reset_tokens SET used=1 WHERE user_id=?",[tokens[0].user_id])
    await connection.query("UPDATE sessions SET revoked=1 WHERE user_id=?",[tokens[0].user_id])
    await connection.commit()
    await writeAudit(req,{userId:tokens[0].user_id,action:"reset_password",entityType:"users",entityId:tokens[0].user_id})
    res.json({ok:true})
  } finally {await connection.rollback();connection.release()}
})
