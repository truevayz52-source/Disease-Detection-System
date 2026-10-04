import { Router } from "../lib/router.js"
import { z } from "zod"
import multer from "multer"
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { newId, query } from "../db.js"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { writeAudit } from "../lib/audit.js"

export const evidenceRouter = Router()

const uploadDir = fileURLToPath(new URL("../../uploads/evidence/", import.meta.url))
fs.mkdirSync(uploadDir, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req, file, cb) => cb(null, `${newId("evf")}${path.extname(file.originalname).slice(0, 12)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
})

const roles = ["medical_officer", "mortuary_clerk", "public_health_analyst", "system_admin"] as const

evidenceRouter.post("/", requireAuth, requireRole(...roles), upload.single("file"), async (req, res) => {
  const parsed = z.object({
    entityType: z.enum(["signal", "notification"]),
    entityId: z.string().max(36),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: "entityType and entityId required" })
  if (!req.file) return res.status(400).json({ error: "No file uploaded" })

  const id = newId("ev")
  await query(
    `INSERT INTO evidence_files (evidence_id, entity_type, entity_id, file_path, original_name, mime_type, size_bytes, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, parsed.data.entityType, parsed.data.entityId, req.file.path, req.file.originalname, req.file.mimetype ?? null, req.file.size, req.user!.userId],
  )
  await writeAudit(req, { action: "evidence_uploaded", entityType: "evidence_files", entityId: id, details: { ...parsed.data } })
  res.status(201).json({ evidenceId: id })
})

evidenceRouter.get("/", requireAuth, requireRole(...roles), async (req, res) => {
  const { entityType, entityId } = req.query as Record<string, string>
  if (!entityType || !entityId) return res.status(400).json({ error: "entityType and entityId required" })
  const items = await query<any[]>(
    `SELECT e.evidence_id, e.entity_type, e.entity_id, e.original_name, e.mime_type, e.size_bytes, e.created_at, u.full_name AS uploaded_by_name
     FROM evidence_files e LEFT JOIN users u ON u.user_id = e.uploaded_by
     WHERE e.entity_type = ? AND e.entity_id = ? ORDER BY e.created_at DESC`,
    [entityType, entityId],
  )
  res.json({ items })
})

evidenceRouter.get("/:id/file", requireAuth, requireRole(...roles), async (req, res) => {
  const rows = await query<any[]>("SELECT * FROM evidence_files WHERE evidence_id = ?", [req.params.id])
  const file = rows[0]
  if (!file || !fs.existsSync(file.file_path)) return res.status(404).json({ error: "File not found" })
  res.setHeader("Content-Type", file.mime_type ?? "application/octet-stream")
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.original_name)}"`)
  fs.createReadStream(file.file_path).pipe(res)
})
