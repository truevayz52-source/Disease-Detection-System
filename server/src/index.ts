import express from "express"
import { ServiceUnavailableError } from "./lib/integrations.js"
import { createServer } from "node:http"
import { attachRealtime } from "./websocket/index.js"
import { attachVoiceStream } from "./routes/voice-stream.js"
import { ZodError } from "zod"
import { twoFactorRouter } from "./routes/two-factor.js"
import { realtimeRouter } from "./routes/notifications-realtime.js"
import { workflowsRouter } from "./routes/workflows.js"
import { operationsRouter } from "./routes/operations.js"
import { reportsRouter } from "./routes/reports.js"
import { offlineRouter } from "./routes/offline-sync.js"
import { passwordResetRouter } from "./routes/password-reset.js"
import { blockchainRouter } from "./routes/blockchain.js"
import { runScheduledReports } from "./lib/scheduled-reports.js"
import { detectOutbreaks } from "./lib/outbreak.js"
import helmet from "helmet"
import cors from "cors"
import compression from "compression"
import { config } from "./config.js"
import { startDiscoveryBeacon } from "./lib/discovery-beacon.js"
import { authRouter } from "./routes/auth.js"
import { icdRouter } from "./routes/icd.js"
import { facilitiesRouter } from "./routes/facilities.js"
import { patientsRouter } from "./routes/patients.js"
import { notificationsRouter } from "./routes/notifications.js"
import { imagesRouter } from "./routes/images.js"
import { autopsiesRouter } from "./routes/autopsies.js"
import { alertsRouter } from "./routes/alerts.js"
import { analyticsRouter } from "./routes/analytics.js"
import { usersRouter } from "./routes/users.js"
import { auditRouter } from "./routes/audit.js"
import { certificatesRouter } from "./routes/certificates.js"
import { userProfileRouter } from "./routes/user-profile.js"
import { outbreakDynamicRouter } from "./routes/outbreak-dynamic.js"
import { emergencyDispatchRouter } from "./routes/emergency-dispatch.js"
import { bulletinRouter } from "./routes/bulletins.js"
import { causalChainRouter } from "./routes/causal-chain.js"
import { dualCodingRouter } from "./routes/dual-coding.js"
import { mpdsrTrackerRouter } from "./routes/mpdsr-tracker.js"
import { verbalAutopsyRouter } from "./routes/verbal-autopsy.js"
import { decodePanelRouter } from "./routes/decode-panel.js"
import { imageAnnotationRouter } from "./routes/image-annotations.js"
import { peerReviewRouter } from "./routes/peer-review.js"
import { specimenTrackingRouter } from "./routes/specimen-tracking.js"
import { crvsBridgeRouter } from "./routes/crvs-bridge.js"
import { communitySurveillanceRouter } from "./routes/community-surveillance.js"
import { environmentalDataRouter } from "./routes/environmental-data.js"
import { gisClusteringRouter } from "./routes/gis-clustering.js"
import { patientAnonymizationRouter } from "./routes/patient-anonymization.js"
import { signalsRouter } from "./routes/signals.js"
import { fhirRouter } from "./routes/fhir.js"
import { playbooksRouter } from "./routes/playbooks.js"
import { evidenceRouter } from "./routes/evidence.js"
import { translateRouter } from "./routes/translate.js"
import { i18nRouter } from "./routes/i18n.js"
import { aiRouter } from "./routes/ai.js"

const app = express()

app.disable("x-powered-by")
app.use(helmet({ contentSecurityPolicy: false })) // API-only; CSP handled by the SPA host
app.use(compression()) // gzip responses — low-bandwidth mobile clients
app.use(cors({ origin: config.clientOrigin, credentials: true }))
app.use(express.json({ limit: "2mb" }))

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "Disease Detection System" }))

app.use("/api", (_req,res,next) => { res.setHeader("Cache-Control","no-store"); next() })
app.use("/api/user", passwordResetRouter)
app.use("/api/user", userProfileRouter)
app.use("/api/user", twoFactorRouter)
app.use("/api/inbox", realtimeRouter)
app.use("/api", workflowsRouter)
app.use("/api", operationsRouter)
app.use("/api/reports", reportsRouter)
app.use("/api/blockchain", blockchainRouter)
app.use("/api/offline", offlineRouter)
app.use("/api/outbreak", outbreakDynamicRouter)
app.use("/api/emergency", emergencyDispatchRouter)
app.use("/api/bulletins", bulletinRouter)
app.use("/api/causal-chain", causalChainRouter)
app.use("/api/dual-coding", dualCodingRouter)
app.use("/api/mpdsr", mpdsrTrackerRouter)
app.use("/api/verbal-autopsy", verbalAutopsyRouter)
app.use("/api/decode-panel", decodePanelRouter)
app.use("/api/image-annotations", imageAnnotationRouter)
app.use("/api/peer-review", peerReviewRouter)
app.use("/api/specimen-tracking", specimenTrackingRouter)
app.use("/api/crvs", crvsBridgeRouter)
app.use("/api/community", communitySurveillanceRouter)
app.use("/api/environmental", environmentalDataRouter)
app.use("/api/gis", gisClusteringRouter)
app.use("/api/anonymization", patientAnonymizationRouter)
app.use("/api/signals", signalsRouter)
app.use("/api/fhir", fhirRouter)
app.use("/api/playbooks", playbooksRouter)
app.use("/api/evidence", evidenceRouter)
app.use("/api/auth", authRouter)
app.use("/api/icd-codes", icdRouter)
app.use("/api/facilities", facilitiesRouter)
app.use("/api/patients", patientsRouter)
app.use("/api/notifications", notificationsRouter)
app.use("/api", imagesRouter)
app.use("/api/autopsies", autopsiesRouter)
app.use("/api/alerts", alertsRouter)
app.use("/api/analytics", analyticsRouter)
app.use("/api/users", usersRouter)
app.use("/api/audit", auditRouter)
app.use("/api", certificatesRouter)
app.use("/api", translateRouter)
app.use("/api/i18n", i18nRouter)
app.use("/api/ai", aiRouter)

app.use((_req, res) => res.status(404).json({ error: "Not found" }))

// Central error boundary — a bad request must never crash the process (Ch 5.3).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ServiceUnavailableError) return res.status(503).json({error:err.message})
  if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({error:"Uploaded file exceeds the permitted size"})
  if (err.name === "MulterError") return res.status(400).json({error:"Invalid file upload"})
  if (err instanceof ZodError) return res.status(400).json({error:err.issues.map(i=>i.message).join("; ")})
  if (err.status && err.status>=400 && err.status<500) return res.status(err.status).json({error:err.message})
  console.error("[api] unhandled error:", err?.message ?? err)
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Payload too large" })
  res.status(500).json({ error: "Internal server error" })
})

const server = createServer(app)
attachRealtime(server)
attachVoiceStream(server)
const reportTimer = setInterval(() => { void runScheduledReports() }, 60000)
reportTimer.unref()

// Automatic outbreak detection every 8 minutes (Ch 4.4). Runs immediately
// on startup so the dashboard is populated without a manual trigger.
const OUTBREAK_INTERVAL_MS = 8 * 60 * 1000
const runOutbreakDetection = () =>
  detectOutbreaks()
    .then((created) => {
      if (created.length) {
        console.log(`[outbreak] scheduled detection created ${created.length} alert(s)`)
      }
    })
    .catch((err) => console.error("[outbreak] scheduled detection failed:", err?.message ?? err))
const outbreakTimer = setInterval(runOutbreakDetection, OUTBREAK_INTERVAL_MS)
outbreakTimer.unref()
runOutbreakDetection()

server.listen(config.port, () => {
  console.log(`[Disease Detection System] API listening on http://127.0.0.1:${config.port}`)
  startDiscoveryBeacon(config.port)
})
