import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import useSWR from "swr"
import { toast } from "sonner"
import { FileCheck, Printer } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { api, getToken } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { fmtDate, fmtDateTime, STATUS_LABELS, STATUS_VARIANTS } from "@/lib/format"
import { usePreferences } from "@/lib/preferences"
import { TranslatedBlock } from "@/components/translated-block"
import { AiSummaryBlock } from "@/components/ai-block"

interface AutopsyFull {
  autopsy_id: string
  notification_id: string
  status: string
  internal_observations: string | null
  toxicology_results: string | null
  legal_threshold_flag: number
  final_icd_code: string | null
  final_cause_of_death: string | null
  digital_signature: string | null
  audit_hash: string
  created_at: string
  finalized_at: string | null
  pathologist_name: string
  patient_name: string
  national_id: string | null
  age: number | null
  gender: string
  facility_name: string
  district: string
  province: string
  date_of_death: string
  preliminary_icd_code: string
  clinical_summary: string | null
}

export default function AutopsyDetailPage() {const{t}=usePreferences();
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { data, mutate } = useSWR<{ autopsy: AutopsyFull }>(id ? `/autopsies/${id}` : null, (u: string) => api(u))
  const [finalizing, setFinalizing] = useState(false)
  const a = data?.autopsy
  const piiFields = a ? [a.patient_name, a.national_id, a.facility_name, a.pathologist_name] : []
  const canFinalize = a?.status !== "finalized" && user && ["pathologist", "system_admin"].includes(user.role)

  async function finalize() {
    setFinalizing(true)
    try {
      await api(`/autopsies/${id}/finalize`, { method: "PATCH" })
      toast.success(t("Autopsy finalized — death certificate is now available."))
      mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Finalize failed")
    } finally {
      setFinalizing(false)
    }
  }

  const certUrl = a ? `/api/notifications/${a.notification_id}/certificate?token=${encodeURIComponent(getToken() ?? "")}` : "#"

  return (
    <>
      <SiteHeader title={t("Autopsy Report")} />
      {!a ? (
        <div className="p-6 text-sm text-muted-foreground">{t("Loading…")}</div>
      ) : (
        <div className="grid gap-6 p-4 lg:grid-cols-3 lg:p-6">
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{a.patient_name}</CardTitle>
              <div className="flex gap-2">
                {!!a.legal_threshold_flag && <Badge variant="destructive">{t("Legal threshold")}</Badge>}
                <Badge variant={STATUS_VARIANTS[a.status] ?? "secondary"}>{t(STATUS_LABELS[a.status] ?? a.status)}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <dt className="text-muted-foreground">{t("National ID")}</dt>
                <dd>{a.national_id ?? "—"}</dd>
                <dt className="text-muted-foreground">{t("Age / Gender")}</dt>
                <dd>{a.age ?? "—"} / {a.gender}</dd>
                <dt className="text-muted-foreground">{t("Date of death")}</dt>
                <dd>{fmtDateTime(a.date_of_death)}</dd>
                <dt className="text-muted-foreground">{t("Facility")}</dt>
                <dd>{a.facility_name}, {a.district}</dd>
                <dt className="text-muted-foreground">{t("Preliminary ICD")}</dt>
                <dd>{a.preliminary_icd_code}</dd>
                <dt className="text-muted-foreground">{t("Final ICD")}</dt>
                <dd className="font-medium">{a.final_icd_code ?? "—"}</dd>
                <dt className="text-muted-foreground">{t("Final cause of death")}</dt>
                <dd className="font-medium">{a.final_cause_of_death ? <TranslatedBlock text={a.final_cause_of_death} pii={piiFields} /> : "—"}</dd>
                <dt className="text-muted-foreground">{t("Pathologist")}</dt>
                <dd>{a.pathologist_name}</dd>
                <dt className="text-muted-foreground">{t("Digital signature")}</dt>
                <dd className="font-serif italic">{a.digital_signature ?? "—"}</dd>
                <dt className="text-muted-foreground">{t("Finalized")}</dt>
                <dd>{fmtDateTime(a.finalized_at)}</dd>
                <dt className="text-muted-foreground">{t("Internal observations")}</dt>
                <dd className="sm:col-span-1 whitespace-pre-wrap">
                  {a.internal_observations ? <TranslatedBlock text={a.internal_observations} pii={piiFields} /> : "—"}
                  <AiSummaryBlock className="mt-2" text={a.internal_observations} pii={piiFields} />
                </dd>
                <dt className="text-muted-foreground">{t("Toxicology results")}</dt>
                <dd className="sm:col-span-1 whitespace-pre-wrap">{a.toxicology_results ? <TranslatedBlock text={a.toxicology_results} pii={piiFields} /> : "—"}</dd>
              </dl>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="text-sm">{t("Integrity")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <p className="text-muted-foreground">{t("Audit hash (SHA-256):")}</p>
                <p className="break-all font-mono">{a.audit_hash}</p>
                <p className="text-muted-foreground">Created {fmtDate(a.created_at)} · Report {a.autopsy_id}</p>
              </CardContent>
            </Card>
            {canFinalize && (
              <Button className="w-full" disabled={finalizing} onClick={finalize}>
                <FileCheck className="size-4" /> Finalize report
              </Button>
            )}
            {a.status === "finalized" && (
              <Button variant="outline" className="w-full" asChild>
                <a href={certUrl} target="_blank" rel="noreferrer">
                  <Printer className="size-4" /> Print death certificate
                </a>
              </Button>
            )}
            <Button variant="ghost" className="w-full" asChild>
              <Link to={`/notifications/${a.notification_id}`}>{t("View notification")}</Link>
            </Button>
          </div>
        </div>
      )}
    </>
  )
}
