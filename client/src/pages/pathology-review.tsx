import { useRef, useState } from "react"
import { PathologyInference, WhoLookup } from "@/components/inference-tools"
import { useNavigate, useParams } from "react-router-dom"
import useSWR from "swr"
import { toast } from "sonner"
import { ImagePlus, Loader2, Minus, Plus, RotateCcw } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { api, authedFileUrl } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import type { AutopsyReport, DeathNotification, IcdCode, TelepathologyImage } from "@/lib/types"
import { TranslatedBlock } from "@/components/translated-block"
import { usePreferences } from "@/lib/preferences"

interface Detail {
  notification: DeathNotification
  images: TelepathologyImage[]
  autopsy: AutopsyReport | null
}

// Pan/zoom tele-pathology viewer (Ch 4.6 Tele-Pathology Viewer).
function ImageViewer({ src, alt }: { src: string; alt: string }) {const{t}=usePreferences();
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  return (
    <div className="relative overflow-hidden rounded-lg border bg-black/90" style={{ height: 420 }}>
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="absolute left-1/2 top-1/2 max-h-full max-w-full cursor-grab select-none active:cursor-grabbing"
        style={{ transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px)) scale(${scale})` }}
        onMouseDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y }
          e.preventDefault()
        }}
        onMouseMove={(e) => {
          if (!drag.current) return
          setPos({ x: drag.current.px + e.clientX - drag.current.x, y: drag.current.py + e.clientY - drag.current.y })
        }}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => (drag.current = null)}
        onWheel={(e) => setScale((s) => Math.min(8, Math.max(0.25, s - Math.sign(e.deltaY) * 0.25)))}
      />
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        <Button size="icon" variant="secondary" onClick={() => setScale((s) => Math.min(8, s + 0.5))}>
          <Plus className="size-4" />
        </Button>
        <Button size="icon" variant="secondary" onClick={() => setScale((s) => Math.max(0.25, s - 0.5))}>
          <Minus className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="secondary"
          onClick={() => {
            setScale(1)
            setPos({ x: 0, y: 0 })
          }}
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>
    </div>
  )
}

export default function PathologyReviewPage() {const{t}=usePreferences();
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data, mutate } = useSWR<Detail>(id ? `/notifications/${id}` : null, (u: string) => api(u))
  const [sel, setSel] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    internalObservations: "",
    toxicologyResults: "",
    legalThresholdFlag: false,
    finalIcdCode: "",
    finalCauseOfDeath: "",
    digitalSignature: "",
  })
  const [icdItems, setIcdItems] = useState<IcdCode[]>([])
  const [saving, setSaving] = useState<"draft" | "final" | null>(null)

  const n = data?.notification
  const img = data?.images[sel]

  async function uploadImage(file: File) {
    const fd = new FormData()
    fd.append("file", file)
    try {
      await api(`/notifications/${id}/images`, { method: "POST", body: fd })
      toast.success(t("Image uploaded."))
      mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    }
  }

  async function searchIcd(q: string) {
    setForm((f) => ({ ...f, finalIcdCode: q }))
    if (q.length < 1) return setIcdItems([])
    try {
      const r = await api<{ items: IcdCode[] }>(`/icd-codes?q=${encodeURIComponent(q)}`)
      setIcdItems(r.items.slice(0, 6))
    } catch {
      /* ignore */
    }
  }

  async function save(finalize: boolean) {
    setSaving(finalize ? "final" : "draft")
    try {
      await api(`/notifications/${id}/autopsy`, {
        method: "POST",
        body: JSON.stringify({ ...form, finalize }),
      })
      toast.success(finalize ? "Autopsy finalized — certificate available." : "Draft autopsy saved.")
      // Revalidate the shared /notifications/:id cache before navigating so
      // the detail page doesn't render stale "no autopsy" data (SWR dedupe).
      await mutate()
      navigate(`/notifications/${id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(null)
    }
  }

  const canSubmit = form.finalIcdCode && form.finalCauseOfDeath.trim() && form.digitalSignature.trim()

  return (
    <>
      <SiteHeader title={t("Tele-Pathology Review")} />
      {!n ? (
        <div className="p-6 text-sm text-muted-foreground">{t("Loading…")}</div>
      ) : (
        <div className="grid gap-6 p-4 lg:grid-cols-2 lg:p-6">
          <div className="space-y-4">
            <Card className="shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">{t("Specimen imagery")}</CardTitle>
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/tiff,image/webp"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])}
                  />
                  <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                    <ImagePlus className="size-4" /> Add image
                  </Button>
                </>
              </CardHeader>
              <CardContent className="space-y-3">
                {img ? (
                  <>
                    <ImageViewer src={authedFileUrl(img.image_id)} alt={img.image_id} />
                    <div className="flex gap-2 overflow-x-auto">
                      {data!.images.map((im, i) => (
                        <button
                          key={im.image_id}
                          onClick={() => setSel(i)}
                          className={`shrink-0 overflow-hidden rounded-md border-2 ${i === sel ? "border-primary" : "border-transparent"}`}
                        >
                          <img src={authedFileUrl(im.image_id)} alt="" className="h-16 w-24 object-cover" />
                        </button>
                      ))}
                    </div>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      sha256:{img.file_hash.slice(0, 32)}… · {fmtDateTime(img.uploaded_timestamp)}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("No images uploaded for this case yet.")}</p>
                )}
              </CardContent>
            </Card>

            {img && <PathologyInference imageId={img.image_id} />}
            <WhoLookup />
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="text-sm">{t("Case context")}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                  <dt className="text-muted-foreground">{t("Patient")}</dt>
                  <dd>{n.patient_name}{!!n.is_maternal_perinatal && <Badge variant="destructive" className="ml-2 text-[10px]">{t("MPDSR")}</Badge>}</dd>
                  <dt className="text-muted-foreground">{t("Age / Gender")}</dt>
                  <dd>{n.age ?? "—"} / {n.gender}</dd>
                  <dt className="text-muted-foreground">{t("Date of death")}</dt>
                  <dd>{fmtDateTime(n.date_of_death)}</dd>
                  <dt className="text-muted-foreground">{t("Preliminary ICD")}</dt>
                  <dd>{n.preliminary_icd_code} — {n.icd_description}</dd>
                  <dt className="text-muted-foreground">{t("Facility")}</dt>
                  <dd>{n.facility_name}, {n.district}</dd>
                  {n.clinical_summary && (
                    <>
                      <dt className="text-muted-foreground">{t("Summary")}</dt>
                      <dd className="whitespace-pre-wrap"><TranslatedBlock text={n.clinical_summary} pii={[n.patient_name, n.national_id, n.facility_name]} /></dd>
                    </>
                  )}
                </dl>
              </CardContent>
            </Card>
          </div>

          <Card className="self-start">
            <CardHeader>
              <CardTitle className="text-base">{t("Autopsy findings")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="obs">{t("Internal observations")}</Label>
                <Textarea id="obs" rows={4} value={form.internalObservations} onChange={(e) => setForm({ ...form, internalObservations: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tox">{t("Toxicology results")}</Label>
                <Textarea id="tox" rows={3} value={form.toxicologyResults} onChange={(e) => setForm({ ...form, toxicologyResults: e.target.value })} />
              </div>
              <div className="relative space-y-2">
                <Label htmlFor="ficd">{t("Final ICD code *")}</Label>
                <Input id="ficd" value={form.finalIcdCode} onChange={(e) => searchIcd(e.target.value)} placeholder={t("e.g. A00")} />
                {icdItems.length > 0 && form.finalIcdCode !== icdItems[0]?.icd_code && (
                  <ul className="absolute z-20 mt-1 max-h-44 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
                    {icdItems.map((c) => (
                      <li key={c.icd_code}>
                        <button
                          type="button"
                          className="w-full rounded-sm px-2 py-1 text-left text-sm hover:bg-accent"
                          onClick={() => {
                            setForm({ ...form, finalIcdCode: c.icd_code })
                            setIcdItems([])
                          }}
                        >
                          <span className="font-mono text-xs font-semibold">{c.icd_code}</span> {c.description}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="fcod">{t("Final cause of death *")}</Label>
                <Input id="fcod" value={form.finalCauseOfDeath} onChange={(e) => setForm({ ...form, finalCauseOfDeath: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sig">{t("Digital signature *")}</Label>
                <Input id="sig" value={form.digitalSignature} onChange={(e) => setForm({ ...form, digitalSignature: e.target.value })} placeholder={t("Type your full name to sign")} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={form.legalThresholdFlag} onCheckedChange={(v) => setForm({ ...form, legalThresholdFlag: v === true })} />
                Flag for legal threshold review (suspicious / unnatural death)
              </label>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1" disabled={!canSubmit || saving !== null} onClick={() => save(false)}>
                  {saving === "draft" && <Loader2 className="size-4 animate-spin" />} Save draft
                </Button>
                <Button className="flex-1" disabled={!canSubmit || saving !== null} onClick={() => save(true)}>
                  {saving === "final" && <Loader2 className="size-4 animate-spin" />} Finalize & sign
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
