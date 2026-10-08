import { CommentThread } from "@/components/comment-thread"
import { AiSummaryBlock } from "@/components/ai-block"
import { useRef, useState } from "react"
import { Link, useParams } from "react-router-dom"
import useSWR from "swr"
import { toast } from "sonner"
import { ImagePlus, Loader2, Printer } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { api, authedFileUrl, getToken } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { fmtDate, fmtDateTime, STATUS_LABELS, STATUS_VARIANTS } from "@/lib/format"
import type { AutopsyReport, DeathNotification, TelepathologyImage } from "@/lib/types"
import { usePreferences } from "@/lib/preferences"
import { TranslatedBlock } from "@/components/translated-block"

interface Detail {
  notification: DeathNotification
  images: TelepathologyImage[]
  autopsy: (AutopsyReport & { pathologist_name?: string }) | null
}

export default function NotificationDetailPage() {const{t}=usePreferences();
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { data, mutate } = useSWR<Detail>(id ? `/notifications/${id}` : null, (u: string) => api(u))
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function uploadImage(file: File) {
    setUploading(true)
    const fd = new FormData()
    fd.append("file", file)
    try {
      await api(`/notifications/${id}/images`, { method: "POST", body: fd })
      toast.success(t("Image uploaded and hashed to case."))
      mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  const n = data?.notification
  const canUpload = user && ["medical_officer", "pathologist", "public_health_analyst", "system_admin"].includes(user.role)
  const certUrl = `/api/notifications/${id}/certificate?token=${encodeURIComponent(getToken() ?? "")}`

  return (
    <>
      <SiteHeader title={t("Notification Detail")} />
      {!n ? (
        <div className="p-6 text-sm text-muted-foreground">{t("Loading…")}</div>
      ) : (
        <div className="grid gap-6 p-4 lg:grid-cols-3 lg:p-6">
          <div className="space-y-6 lg:col-span-2"><CommentThread notificationId={id!} />
            <Card className="shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">{n.patient_name}</CardTitle>
                <div className="flex items-center gap-2">
                  {!!n.is_maternal_perinatal && <Badge variant="destructive">{t("MPDSR")}</Badge>}
                  <Badge variant={STATUS_VARIANTS[n.status] ?? "secondary"}>{t(STATUS_LABELS[n.status] ?? n.status)}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <dt className="text-muted-foreground">{t("National ID")}</dt>
                  <dd>{n.national_id ?? "—"}</dd>
                  <dt className="text-muted-foreground">{t("Age / Gender")}</dt>
                  <dd>{n.age ?? "—"} / {n.gender}</dd>
                  <dt className="text-muted-foreground">{t("Address")}</dt>
                  <dd>{n.residential_address ?? "—"}</dd>
                  <dt className="text-muted-foreground">{t("Date of death")}</dt>
                  <dd>{fmtDateTime(n.date_of_death)}</dd>
                  <dt className="text-muted-foreground">{t("Preliminary ICD")}</dt>
                  <dd>{n.preliminary_icd_code} — {n.icd_description}</dd>
                  <dt className="text-muted-foreground">{t("Category")}</dt>
                  <dd>{n.disease_category}</dd>
                  <dt className="text-muted-foreground">{t("Facility")}</dt>
                  <dd>{n.facility_name}, {n.district}</dd>
                  <dt className="text-muted-foreground">{t("Reported by")}</dt>
                  <dd>{n.reported_by_name} · {fmtDate(n.created_at)}</dd>
                  {n.clinical_summary && (
                    <>
                      <dt className="text-muted-foreground">{t("Clinical summary")}</dt>
                      <dd className="sm:col-span-1 whitespace-pre-wrap">
                        <TranslatedBlock text={n.clinical_summary} pii={[n.patient_name, n.national_id, n.residential_address, n.facility_name, n.reported_by_name]} />
                        <AiSummaryBlock className="mt-2" text={n.clinical_summary} pii={[n.patient_name, n.national_id, n.residential_address, n.facility_name, n.reported_by_name]} />
                      </dd>
                    </>
                  )}
                </dl>
              </CardContent>
            </Card>

            <Card className="shadow-lg">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm">Tele-pathology images ({data?.images.length ?? 0})</CardTitle>
                {canUpload && (
                  <>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/tiff,image/webp"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && uploadImage(e.target.files[0])}
                    />
                    <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
                      {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                      Upload image
                    </Button>
                  </>
                )}
              </CardHeader>
              <CardContent>
                {data?.images.length ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {data.images.map((img) => (
                      <a key={img.image_id} href={authedFileUrl(img.image_id)} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-lg border">
                        <img src={authedFileUrl(img.image_id)} alt="" className="aspect-video w-full object-cover transition group-hover:scale-[1.02]" />
                        <div className="p-2 text-xs text-muted-foreground">
                          <span className="block truncate font-mono">sha256: {img.file_hash.slice(0, 24)}…</span>
                          {fmtDateTime(img.uploaded_timestamp)} · {(img.original_size_bytes / 1024 / 1024).toFixed(2)} MB
                        </div>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("No pathology images uploaded yet.")}</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="text-sm">{t("Autopsy report")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {data?.autopsy ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{t("Status")}</span>
                      <Badge variant={STATUS_VARIANTS[data.autopsy.status] ?? "secondary"}>
                        {t(STATUS_LABELS[data.autopsy.status] ?? data.autopsy.status)}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">{t("Pathologist")}</span>
                      <span>{data.autopsy.pathologist_name}</span>
                    </div>
                    {data.autopsy.final_icd_code && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">{t("Final ICD")}</span>
                        <span>{data.autopsy.final_icd_code}</span>
                      </div>
                    )}
                    {!!data.autopsy.legal_threshold_flag && (
                      <Badge variant="destructive">{t("Legal threshold flagged")}</Badge>
                    )}
                    <Button variant="outline" size="sm" className="w-full" asChild>
                      <Link to={`/autopsy/${data.autopsy.autopsy_id}`}>{t("View report")}</Link>
                    </Button>
                  </>
                ) : (
                  <p className="text-muted-foreground">{t("No autopsy report yet.")}</p>
                )}
                {n.status === "finalized" && (
                  <Button variant="outline" size="sm" className="w-full" asChild>
                    <a href={certUrl} target="_blank" rel="noreferrer">
                      <Printer className="size-4" /> Death certificate
                    </a>
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
