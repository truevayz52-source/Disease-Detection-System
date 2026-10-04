import fs from 'node:fs'
function edit(file,fn){fs.writeFileSync(file,fn(fs.readFileSync(file,'utf8')))}
edit('server/src/routes/notifications.ts',s=>{
  s='import { createNotification } from "../lib/notification-service.js"\n'+s
  const start=s.indexOf('const createSchema ='),end=s.indexOf('notificationsRouter.get("/:id"',start)
  return s.slice(0,start)+`notificationsRouter.post("/", requireAuth, async (req,res) => { res.status(201).json(await createNotification(req,req.body)) })\n\n`+s.slice(end)
})
edit('server/src/index.ts',s=>s.replace('import express from "express"',`import express from "express"
import { ZodError } from "zod"
import { twoFactorRouter } from "./routes/two-factor.js"
import { realtimeRouter } from "./routes/notifications-realtime.js"
import { workflowsRouter } from "./routes/workflows.js"
import { operationsRouter } from "./routes/operations.js"
import { reportsRouter } from "./routes/reports.js"
import { offlineRouter } from "./routes/offline-sync.js"`).replace('app.use("/api/auth",',`app.use("/api", (_req,res,next) => { res.setHeader("Cache-Control","no-store"); next() })
app.use("/api/user", userProfileRouter)
app.use("/api/user", twoFactorRouter)
app.use("/api/inbox", realtimeRouter)
app.use("/api", workflowsRouter)
app.use("/api", operationsRouter)
app.use("/api/reports", reportsRouter)
app.use("/api/offline", offlineRouter)
app.use("/api/auth",`).replace('  console.error("[api] unhandled error:",',`  if (err instanceof ZodError) return res.status(400).json({error:err.issues.map(i=>i.message).join("; ")})
  if (err.status && err.status>=400 && err.status<500) return res.status(err.status).json({error:err.message})
  console.error("[api] unhandled error:",`))
