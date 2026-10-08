import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import useSWR from "swr"
import { Baby, Eye, FileSearch, Hourglass, Microscope, RefreshCw, Search, TimerOff } from "lucide-react"
import { FacilityCombobox } from "@/components/facility-combobox"
import { SiteHeader } from "@/components/site-header"
import { StatCard } from "@/components/stat-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api"
import { fmtDate, fmtDateTime, STATUS_LABELS, STATUS_VARIANTS } from "@/lib/format"
import type { DeathNotification } from "@/lib/types"
import { usePreferences } from "@/lib/preferences"

const DAY = 86400000

function daysWaiting(n: DeathNotification) {
  return Math.floor((Date.now() - new Date(n.created_at || n.date_of_death).getTime()) / DAY)
}

export default function PathologyQueuePage() {const{t}=usePreferences();
  const { data, isLoading, error, isValidating, mutate } = useSWR<{ items: DeathNotification[] }>(
    "/notifications", (u: string) => api(u), { refreshInterval: 30_000 },
  )

  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("all")
  const [facility, setFacility] = useState("all")
  const [sort, setSort] = useState<"oldest" | "newest">("oldest")

  const queue = useMemo(
    () => (data?.items ?? []).filter((n) => ["pending_review", "under_review"].includes(n.status)),
    [data],
  )

  const stats = useMemo(() => ({
    total: queue.length,
    pending: queue.filter((n) => n.status === "pending_review").length,
    underReview: queue.filter((n) => n.status === "under_review").length,
    mpdsr: queue.filter((n) => n.is_maternal_perinatal).length,
    stale: queue.filter((n) => daysWaiting(n) > 7).length,
  }), [queue])

  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = queue.filter((n) => {
      if (status !== "all" && n.status !== status) return false
      if (facility !== "all" && n.facility_name !== facility) return false
      if (!q) return true
      return [n.patient_name, n.preliminary_icd_code, n.icd_description, n.facility_name, n.district, n.province]
        .some((v) => v?.toLowerCase().includes(q))
    })
    return list.sort((a, b) => {
      const d = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      return sort === "oldest" ? d : -d
    })
  }, [queue, search, status, facility, sort])

  const statCards = [
    { label: t("In queue"), value: stats.total, icon: FileSearch, color: "blue" as const },
    { label: t("Pending review"), value: stats.pending, icon: Hourglass, color: "amber" as const },
    { label: t("Under review"), value: stats.underReview, icon: Microscope, color: "purple" as const },
    { label: t("MPDSR cases"), value: stats.mpdsr, icon: Baby, color: "red" as const },
    { label: t("Waiting > 7 days"), value: stats.stale, icon: TimerOff, color: "slate" as const },
  ]

  return (
    <>
      <SiteHeader title={t("Pathology Review Queue")} />
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
            <Input className="pl-8" placeholder={t("Search patient, ICD, facility…")} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v ?? "all")}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All statuses")}</SelectItem>
              <SelectItem value="pending_review">{t("Pending review")}</SelectItem>
              <SelectItem value="under_review">{t("Under review")}</SelectItem>
            </SelectContent>
          </Select>
          <FacilityCombobox
            value={facility === "all" ? "" : facility}
            onChange={(v) => setFacility(v || "all")}
          />
          <Select value={sort} onValueChange={(v) => setSort(v === "newest" ? "newest" : "oldest")}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="oldest">{t("Oldest first")}</SelectItem>
              <SelectItem value="newest">{t("Newest first")}</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" title={t("Refresh")} onClick={() => mutate()}><RefreshCw className={`size-4 ${isValidating ? "animate-spin" : ""}`} /></Button>
          <p className="ml-auto text-sm text-muted-foreground">{items.length} of {queue.length} case{queue.length === 1 ? "" : "s"}</p>
        </div>

        {/* table */}
        <Card className="shadow-lg">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Patient")}</TableHead>
                  <TableHead>{t("ICD")}</TableHead>
                  <TableHead>{t("Facility")}</TableHead>
                  <TableHead>{t("Date of death")}</TableHead>
                  <TableHead>{t("Waiting")}</TableHead>
                  <TableHead>{t("Status")}</TableHead>
                  <TableHead className="text-right">{t("Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((n) => {
                  const days = daysWaiting(n)
                  return (
                    <TableRow key={n.notification_id}>
                      <TableCell className="font-medium">
                        {n.patient_name}
                        {!!n.is_maternal_perinatal && <Badge variant="destructive" className="ml-2 text-[10px]">{t("MPDSR")}</Badge>}
                      </TableCell>
                      <TableCell>
                        <span className="tabular-nums font-medium">{n.preliminary_icd_code}</span>
                        {n.icd_description && <p className="max-w-40 truncate text-[10px] text-muted-foreground">{n.icd_description}</p>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {n.facility_name}
                        {n.district && <p className="text-[10px]">{n.district}{n.province ? `, ${n.province}` : ""}</p>}
                      </TableCell>
                      <TableCell>{fmtDate(n.date_of_death)}</TableCell>
                      <TableCell>
                        <Badge variant={days > 7 ? "destructive" : days > 3 ? "secondary" : "outline"} className="tabular-nums">
                          {days}d
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANTS[n.status] ?? "secondary"}>{t(STATUS_LABELS[n.status] ?? n.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="ghost" asChild title={t("View notification record")}>
                            <Link to={`/notifications/${n.notification_id}`}><Eye className="size-3.5" /></Link>
                          </Button>
                          <Button size="sm" asChild>
                            <Link to={`/pathology/review/${n.notification_id}`}>{t("Review")}</Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {!items.length && !isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      {queue.length ? "No cases match the current filters." : "Queue is empty — all caught up."}
                    </TableCell>
                  </TableRow>
                )}
                {isLoading && (
                  <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">{t("Loading…")}</TableCell></TableRow>
                )}
                {error && !isLoading && (
                  <TableRow><TableCell colSpan={7} className="py-10 text-center text-destructive">{t("Failed to load queue.")}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">Submitted {items.length ? fmtDateTime(items[0]?.created_at) : ""} · auto-refresh every 30s</p>
      </div>
    </>
  )
}
