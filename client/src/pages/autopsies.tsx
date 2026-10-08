import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import useSWR from "swr"
import { Download, Eye, FileCheck, FilePen, Gavel, RefreshCw, Search, Stethoscope } from "lucide-react"
import { FacilityCombobox } from "@/components/facility-combobox"
import { StatCard } from "@/components/stat-card"
import { SiteHeader } from "@/components/site-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api"
import { fmtDate, STATUS_LABELS, STATUS_VARIANTS } from "@/lib/format"
import type { AutopsyReport } from "@/lib/types"
import { usePreferences } from "@/lib/preferences"

const STATUSES = ["draft", "finalized"] as const

export default function AutopsiesPage() {const{t}=usePreferences();
  const { data, mutate } = useSWR<{ items: AutopsyReport[] }>("/autopsies", (u: string) => api(u))
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [facilityFilter, setFacilityFilter] = useState("all")

  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.items ?? []).filter((a) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false
      if (facilityFilter !== "all" && a.facility_name !== facilityFilter) return false
      if (!q) return true
      return [a.patient_name, a.facility_name, a.pathologist_name, a.final_cause_of_death, a.final_icd_code]
        .some((v) => v?.toLowerCase().includes(q))
    })
  }, [data, search, statusFilter, facilityFilter])

  const stats = useMemo(() => {
    const all = data?.items ?? []
    return {
      total: all.length,
      draft: all.filter((a) => a.status === "draft").length,
      finalized: all.filter((a) => a.status === "finalized").length,
      legal: all.filter((a) => a.legal_threshold_flag).length,
    }
  }, [data])

  function exportCsv() {
    const header = ["Patient", "Facility", "Final cause", "ICD", "Pathologist", "Created", "Status", "Legal"]
    const rows = items.map((a) => [a.patient_name, a.facility_name, a.final_cause_of_death, a.final_icd_code, a.pathologist_name, a.created_at, t(STATUS_LABELS[a.status] ?? a.status), a.legal_threshold_flag ? t("Yes") : t("No")])
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replaceAll('"', '""')}"`).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
    const a = document.createElement("a"); a.href = url; a.download = `autopsies-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <SiteHeader title={t("Autopsy Reports")} />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label={t("Total reports")} value={stats.total} icon={Stethoscope} color="blue" compact />
          <StatCard label={t("Draft")} value={stats.draft} icon={FilePen} color="amber" compact />
          <StatCard label={t("Finalized")} value={stats.finalized} icon={FileCheck} color="emerald" compact />
          <StatCard label={t("Legal threshold")} value={stats.legal} icon={Gavel} color="red" compact />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Search patient, facility, cause, ICD…")}
              className="pl-8"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All statuses")}</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{t(STATUS_LABELS[s] ?? s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FacilityCombobox
            value={facilityFilter === "all" ? "" : facilityFilter}
            onChange={(v) => setFacilityFilter(v || "all")}
          />
          <Button variant="outline" size="sm" onClick={() => mutate()}><RefreshCw className="size-3.5" /> {t("Refresh")}</Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!items.length}><Download className="size-3.5" /> {t("Export CSV")}</Button>
          <p className="ml-auto text-sm text-muted-foreground">{items.length} report(s)</p>
        </div>

        <Card className="shadow-lg">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Patient")}</TableHead>
                  <TableHead>{t("Facility")}</TableHead>
                  <TableHead>{t("Final cause")}</TableHead>
                  <TableHead>{t("Pathologist")}</TableHead>
                  <TableHead>{t("Created")}</TableHead>
                  <TableHead>{t("Status")}</TableHead>
                  <TableHead className="text-right">{t("Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((a) => (
                  <TableRow key={a.autopsy_id}>
                    <TableCell>
                      <Link to={`/autopsy/${a.autopsy_id}`} className="font-medium hover:underline">
                        {a.patient_name}
                      </Link>
                      {!!a.legal_threshold_flag && (
                        <Badge variant="destructive" className="ml-2 text-[10px]">{t("LEGAL")}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{a.facility_name}</TableCell>
                    <TableCell>
                      {a.final_icd_code && <span className="mr-1 font-mono text-xs">{a.final_icd_code}</span>}
                      {a.final_cause_of_death}
                    </TableCell>
                    <TableCell>{a.pathologist_name}</TableCell>
                    <TableCell>{fmtDate(a.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[a.status] ?? "secondary"}>
                        {t(STATUS_LABELS[a.status] ?? a.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" asChild>
                        <Link to={`/autopsy/${a.autopsy_id}`}><Eye className="size-4" /> {t("View")}</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!items.length && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      No autopsy reports match your filters.
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
