import { useState } from "react"
import useSWR from "swr"
import { RefreshCw, ShieldCheck, ShieldX } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import type { AuditRow } from "@/lib/types"
import { usePreferences } from "@/lib/preferences"

interface AuditList {
  items: AuditRow[]
  page: number
  size: number
  total: number
}

export default function AuditPage() {const{t}=usePreferences();
  const [page, setPage] = useState(1)
  const [actionFilter, setActionFilter] = useState("")
  const [entityFilter, setEntityFilter] = useState("")
  const params = new URLSearchParams({ page: String(page), size: "25" })
  if (actionFilter.trim()) params.set("action", actionFilter.trim())
  if (entityFilter.trim()) params.set("entityType", entityFilter.trim())
  const { data, mutate } = useSWR<AuditList>(`/audit?${params}`, (u: string) => api(u))
  const { data: integrity } = useSWR<{ valid: boolean; brokenAt?: string; checked: number }>(
    "/audit/verify",
    (u: string) => api(u),
  )
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 25))

  return (
    <>
      <SiteHeader title={t("Audit Trail")} />
      <div className="space-y-4 p-4 lg:p-6">
        <Card className={integrity?.valid ? "border-emerald-500/40 shadow-lg" : "border-destructive/50 shadow-lg"}>
          <CardHeader className="flex flex-row items-center gap-3 space-y-0">
            {integrity?.valid ? (
              <ShieldCheck className="size-5 text-emerald-600" />
            ) : (
              <ShieldX className="size-5 text-destructive" />
            )}
            <CardTitle className="text-sm">
              Hash-chain integrity:{" "}
              {integrity ? (integrity.valid ? `VALID — ${integrity.checked} entries verified` : `BROKEN at ${integrity.brokenAt}`) : "checking…"}
            </CardTitle>
          </CardHeader>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Input className="w-52" placeholder={t("Filter by action (e.g. login)")} value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1) }} />
          <Input className="w-52" placeholder={t("Filter by entity (e.g. notification)")} value={entityFilter} onChange={(e) => { setEntityFilter(e.target.value); setPage(1) }} />
          <Button variant="outline" size="sm" onClick={() => mutate()}><RefreshCw className="size-3.5" /> Refresh</Button>
        </div>

        <Card className="shadow-lg">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Hash</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.items ?? []).map((a) => (
                  <TableRow key={a.audit_id}>
                    <TableCell className="whitespace-nowrap">{fmtDateTime(a.created_at)}</TableCell>
                    <TableCell>{a.user_name ?? "system"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[11px]">{a.action}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {a.entity_type}
                      {a.entity_id && <span className="ml-1 font-mono text-[11px]">({a.entity_id.slice(0, 14)}…)</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{a.ip_address ?? "—"}</TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground">
                      {a.record_hash.slice(0, 12)}…
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pages} · {data?.total ?? 0} entries
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
