import { Router } from "../lib/router.js"
import { canAccessNotification } from "../lib/access.js"
import multer from "multer"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { requireAuth, requireRole } from "../auth/middleware.js"
import { newId, query } from "../db.js"
import { writeAudit } from "../lib/audit.js"
import { config } from "../config.js"

export const imagesRouter = Router()

fs.mkdirSync(config.uploadsDir, { recursive: true })

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB tele-pathology slides (TC-02)
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/tiff", "image/webp"].includes(file.mimetype)
    cb(null, ok)
  },
})

// The declared mimetype comes from the client — verify the bytes too.
export function sniffImageType(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | "image/tiff" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg"
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png"
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp"
  if (buf.length >= 4 && (buf.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || buf.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])))) return "image/tiff"
  return null
}

// Tele-pathology upload (Ch 4.2): hash the bytes, store, link to the case.
imagesRouter.post(
  "/notifications/:id/images",
  requireAuth,
  requireRole("medical_officer", "pathologist", "public_health_analyst", "system_admin"),
  upload.single("file"),
  async (req, res) => {
    if (!await canAccessNotification(req.user!, req.params.id, true)) return res.status(403).json({ error: "Forbidden" })
    if (!req.file) return res.status(400).json({ error: "No image file (jpeg/png/tiff/webp, ≤50MB)" })
    if (sniffImageType(req.file.buffer) !== req.file.mimetype) {
      return res.status(400).json({ error: "File contents do not match the declared image type" })
    }

    const notif = await query<any[]>("SELECT notification_id FROM death_notifications WHERE notification_id = ?", [
      req.params.id,
    ])
    if (!notif.length) return res.status(404).json({ error: "Notification not found" })

    const imageId = newId("img")
    const fileHash = crypto.createHash("sha256").update(req.file.buffer).digest("hex")
    const ext = req.file.mimetype === "image/png" ? ".png" : req.file.mimetype === "image/webp" ? ".webp" : ".jpg"
    const fileName = `${imageId}${ext}`
    const filePath = path.join(config.uploadsDir, fileName)

    // Insert first — on write failure the row is removed; on insert failure no
    // file ever lands on disk, so neither direction leaves an orphan.
    await query(
      `INSERT INTO tele_pathology_images
       (image_id, notification_id, file_path, mime_type, resolution, file_hash, original_size_bytes, compressed_size_bytes, compressed, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        imageId,
        req.params.id,
        `uploads/${fileName}`,
        req.file.mimetype,
        req.body.resolution ?? null,
        fileHash,
        req.file.size,
        req.file.size,
        false,
        req.user!.userId,
      ],
    )
    try {
      fs.writeFileSync(filePath, req.file.buffer)
    } catch (err) {
      await query("DELETE FROM tele_pathology_images WHERE image_id = ?", [imageId])
      throw err
    }
    await query("UPDATE death_notifications SET status = 'under_review' WHERE notification_id = ? AND status = 'pending_review'", [
      req.params.id,
    ])
    await writeAudit(req, {
      action: "upload_telepathology_image",
      entityType: "tele_pathology_images",
      entityId: imageId,
      details: { notificationId: req.params.id, sizeBytes: req.file.size, fileHash },
    })
    res.status(201).json({ imageId, fileHash })
  },
)

imagesRouter.get("/notifications/:id/images", requireAuth, async (req, res) => {
  if (!await canAccessNotification(req.user!, req.params.id, true)) return res.status(403).json({ error: "Forbidden" })
  const rows = await query<any[]>(
    `SELECT i.image_id, i.mime_type, i.resolution, i.file_hash, i.original_size_bytes, i.compressed_size_bytes,
            i.compressed, i.uploaded_timestamp, u.full_name AS uploaded_by_name
     FROM tele_pathology_images i JOIN users u ON u.user_id = i.uploaded_by
     WHERE i.notification_id = ? ORDER BY i.uploaded_timestamp`,
    [req.params.id],
  )
  res.json({ items: rows })
})

imagesRouter.get("/images/:id/file", requireAuth, async (req, res) => {
  const rows = await query<any[]>("SELECT file_path, mime_type, notification_id FROM tele_pathology_images WHERE image_id = ?", [
    req.params.id,
  ])
  const row = rows[0]
  if (!row) return res.status(404).json({ error: "Image not found" })
  if (!await canAccessNotification(req.user!, row.notification_id, true)) return res.status(403).json({ error: "Forbidden" })
  const abs = path.resolve(config.uploadsDir, "..", row.file_path)
  if (!fs.existsSync(abs)) return res.status(404).json({ error: "File missing on disk" })
  res.type(row.mime_type ?? "application/octet-stream")
  fs.createReadStream(abs).pipe(res)
})
