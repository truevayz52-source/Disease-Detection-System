import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import useSWR from "swr"
import { Baby, ClipboardList, Download, Eye, FileCheck, Hourglass, Microscope, Plus, RefreshCw, Search } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { StatCard } from "@/components/stat-card"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api"
import { fmtDate, STATUS_LABELS, STATUS_VARIANTS } from "@/lib/format"
import type { DeathNotification } from "@/lib/types"
import { usePreferences } from "@/lib/preferences"

const fetcher = <T,>(url: string) => api<T>(url)

function exportCsv(items: DeathNotification[]) {
  const header = ["Patient", "National ID", "ICD", "Diagnosis", "Facility", "District", "Province", "Date of death", "Status", "MPDSR"]
  const rows = items.map((n) => [
    n.patient_name, n.national_id ?? "", n.preliminary_icd_code, n.icd_description,
    n.facility_name, n.district, n.province, n.date_of_death,
    STATUS_LABELS[n.status] ?? n.status, n.is_maternal_perinatal ? "Yes" : "No",
  ])
  const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replaceAll('"', '""')}"`).join(",")).join("\n")
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
  const a = document.createElement("a")
  a.href = url
  a.download = `death-notifications-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function NotificationsPage() {const{t}=usePreferences();
  const [q, setQ] = useState(")")
  const [status, setStatus] = useState("all")
  const [district, setDistrict] = useState("all")
  const [mpdsrOnly, setMpdsrOnly] = useState(false)
  const [sort, setSort] = useState<"newest" | "oldest">("newest")

  const params = new URLSearchParams()
  if (q) params.set("q", q)
  if (status !== "all") params.set("status", status)
  if (district !== "all") params.set("district", district)
  const { data, isLoading, mutate } = useSWR<{ items: DeathNotification[] }>(`/notifications?${params}`, fetcher)

  const items = useMemo(() => {
    const list = (data?.items ?? []).filter((n) => !mpdsrOnly || !!n.is_maternal_perinatal)
    return [...list].sort((a, b) => {
      const d = new Date(a.date_of_death).getTime() - new Date(b.date_of_death).getTime()
      return sort === "oldest" ? d : -d
    })
  }, [data, mpdsrOnly, sort])

  const districts = useMemo(
    () => [...new Set((data?.items ?? []).map((n) => n.district).filter(Boolean))].sort(),
    [data],
  )

  const stats = useMemo(() => {
    const all = data?.items ?? []
    return {
      total: all.length,
      pending: all.filter((n) => n.status === "pending_review").length,
      underReview: all.filter((n) => n.status === "under_review").length,
      finalized: all.filter((n) => n.status === "finalized" || n.status === "autopsy_complete").length,
      mpdsr: all.filter((n) => n.is_maternal_perinatal).length,
    }
  }, [data])

  const statCards = [
    { label: t("Records shown"), value: stats.total, icon: ClipboardList, color: "blue" as const },
    { label: t("Pending review"), value: stats.pending, icon: Hourglass, color: "amber" as const },
    { label: t("Under review"), value: stats.underReview, icon: Microscope, color: "purple" as const },
    { label: "Finalized", value: stats.finalized, icon: FileCheck, color: "emerald" as const },
    { label: t("MPDSR cases"), value: stats.mpdsr, icon: Baby, color: "red" as const },
  ]

  return (
    <>
      <SiteHeader title={t("Death Notifications")} />
      <div className="space-y-4 p-4 lg:p-6">
        {/* stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {statCards.map((c) => (
            <StatCard key={c.label} {...c} compact />
          ))}
        </div>

        {/* toolbar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder={t("Search patient or national ID…")} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v ?? "all")}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All statuses")}</SelectItem>
              <SelectItem value="pending_review">{t("Pending review")}</SelectItem>
              <SelectItem value="under_review">{t("Under review")}</SelectItem>
              <SelectItem value="autopsy_complete">{t("Autopsy complete")}</SelectItem>
              <SelectItem value="finalized">Finalized</SelectItem>
            </SelectContent>
          </Select>
          <Select value={district} onValueChange={(v) => setDistrict(v ?? "all")}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All districts")}</SelectItem>
              {districts.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort((v as "newest" | "oldest") ?? "newest")}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">{t("Newest first")}</SelectItem>
              <SelectItem value="oldest">{t("Oldest first")}</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
            <input type="checkbox" checked={mpdsrOnly} onChange={(e) => setMpdsrOnly(e.target.checked)} className="accent-red-600" />
            MPDSR only
          </label>
          <Button variant="outline" size="sm" onClick={() => mutate()}>
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportCsv(items)} disabled={!items.length}>
            <Download className="size-3.5" /> Export CSV
          </Button>
          <Button asChild className="ml-auto">
            <Link to="/notifications/new"><Plus className="size-4" /> {t("New notification")}</Link>
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">{items.length} record(s)</p>

        <Card className="shadow-lg">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>{t("National ID")}</TableHead>
                  <TableHead>ICD</TableHead>
                  <TableHead>Facility</TableHead>
                  <TableHead>District</TableHead>
                  <TableHead>{t("Date of death")}</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((n) => (
                  <TableRow key={n.notification_id}>
                    <TableCell>
                      <Link to={`/notifications/${n.notification_id}`} className="font-medium hover:underline">
                        {n.patient_name}
                      </Link>
                      {!!n.is_maternal_perinatal && (
                        <Badge variant="destructive" className="ml-2 text-[10px]">MPDSR</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{n.national_id ?? "—"}</TableCell>
                    <TableCell>
                      <span className="tabular-nums font-medium">{n.preliminary_icd_code}</span>
                      <span className="ml-1 text-xs text-muted-foreground">{n.icd_description}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{n.facility_name}</TableCell>
                    <TableCell>{n.district}</TableCell>
                    <TableCell>{fmtDate(n.date_of_death)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[n.status] ?? "secondary"}>
                        {STATUS_LABELS[n.status] ?? n.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/notifications/${n.notification_id}`}><Eye className="size-4" /> View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {isLoading && (
                  <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">{t("Loading…")}</TableCell></TableRow>
                )}
                {!isLoading && !items.length && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                      No notifications match your filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
