import { useMemo, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { RefreshCw, Search, ShieldCheck, UserCheck, UserPlus, Users, UserX } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { StatCard } from "@/components/stat-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api"
import type { Role } from "@/lib/auth"
import { fmtDate } from "@/lib/format"
import { ROLE_BADGE_VARIANT, ROLE_LABELS } from "@/lib/roles"
import type { Facility, UserRow } from "@/lib/types"
import { usePreferences } from "@/lib/preferences"

const ROLES: Role[] = ["medical_officer", "pathologist", "public_health_analyst", "system_admin", "mortuary_clerk", "executive"]

export default function AdminUsersPage() {const{t}=usePreferences();
  const { data, mutate } = useSWR<{ items: UserRow[] }>("/users", (u: string) => api(u))
  const { data: facilities } = useSWR<{ items: Facility[] }>("/facilities", (u: string) => api(u))
  const { data: geo } = useSWR<{ provinces: { province_id: string; province_name: string }[]; districts: { district_id: string; province: string; district: string }[] }>("/facilities/geo", (u: string) => api(u))
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState("all")
  const [form, setForm] = useState({ fullName: "", email: "", password: "", role: "medical_officer" as Role, facilityId: "", province: "", district: "" })
  const [saving, setSaving] = useState(false)

  async function createUser() {
    setSaving(true)
    try {
      await api("/users", {
        method: "POST",
        body: JSON.stringify({ ...form, facilityId: form.facilityId || null, province: form.province || null, district: form.district || null }),
      })
      toast.success(t("User created."))
      setOpen(false)
      setForm({ fullName: "", email: "", password: "", role: "medical_officer", facilityId: "", province: "", district: "" })
      mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed")
    } finally {
      setSaving(false)
    }
  }

  async function setStatus(u: UserRow, status: "active" | "disabled") {
    try {
      await api(`/users/${u.user_id}`, { method: "PATCH", body: JSON.stringify({ status }) })
      toast.success(`User ${status === "active" ? "enabled" : "disabled"}.`)
      mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed")
    }
  }

  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.items ?? []).filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false
      if (!q) return true
      return [u.full_name, u.email, u.facility_name].some((v) => v?.toLowerCase().includes(q))
    })
  }, [data, search, roleFilter])

  const stats = useMemo(() => {
    const all = data?.items ?? []
    return {
      total: all.length,
      active: all.filter((u) => u.status === "active").length,
      disabled: all.filter((u) => u.status !== "active").length,
      facilityUsers: all.filter((u) => u.facility_name).length,
    }
  }, [data])

  return (
    <>
      <SiteHeader title={t("User Management")} />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label={t("Total accounts")} value={stats.total} icon={Users} color="blue" compact />
          <StatCard label={t("Active")} value={stats.active} icon={UserCheck} color="emerald" compact />
          <StatCard label={t("Disabled")} value={stats.disabled} icon={UserX} color="red" compact />
          <StatCard label={t("Facility-linked")} value={stats.facilityUsers} icon={ShieldCheck} color="purple" compact />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder={t("Search name, email or facility…")} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v ?? "all")}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All roles")}</SelectItem>
              {ROLES.map((r) => <SelectItem key={r} value={r}>{t(ROLE_LABELS[r] ?? r)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => mutate()}><RefreshCw className="size-3.5" /> {t("Refresh")}</Button>
          <p className="ml-auto text-sm text-muted-foreground">{items.length} of {data?.items.length ?? 0} account(s)</p>
          <Button size="sm" onClick={() => setOpen(true)}>
            <UserPlus className="size-4" /> New user
          </Button>
        </div>
        <Card className="shadow-lg">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Name")}</TableHead>
                  <TableHead>{t("Email")}</TableHead>
                  <TableHead>{t("Role")}</TableHead>
                  <TableHead>{t("Facility")}</TableHead>
                  <TableHead>{t("Created")}</TableHead>
                  <TableHead>{t("Status")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((u) => (
                  <TableRow key={u.user_id}>
                    <TableCell className="font-medium">{u.full_name}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={ROLE_BADGE_VARIANT[u.role as Role] ?? "outline"}>
                        {t(ROLE_LABELS[u.role as Role] ?? u.role)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.facility_name ?? "—"}</TableCell>
                    <TableCell>{fmtDate(u.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant={u.status === "active" ? "outline" : "destructive"}>{u.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setStatus(u, u.status === "active" ? "disabled" : "active")}
                      >
                        {u.status === "active" ? "Disable" : "Enable"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!items.length && (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{t("No users match your filters.")}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Provision new user")}</DialogTitle>
            <DialogDescription>{t("Creates an account with a temporary password.")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>{t("Full name")}</Label>
              <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{t("Email")}</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{t("Temporary password (min 8 chars)")}</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("Role")}</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{t(ROLE_LABELS[r] ?? r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("Facility (optional)")}</Label>
                <Select value={form.facilityId} onValueChange={(v) => setForm({ ...form, facilityId: v ?? "" })}>
                  <SelectTrigger><SelectValue placeholder={t("None")} /></SelectTrigger>
                  <SelectContent>
                    {(facilities?.items ?? []).map((f) => (
                      <SelectItem key={f.facility_id} value={f.facility_id}>{f.facility_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("Province scope (optional)")}</Label>
                <Select value={form.province} onValueChange={(v) => setForm({ ...form, province: v ?? "", district: "" })}>
                  <SelectTrigger><SelectValue placeholder={t("None")} /></SelectTrigger>
                  <SelectContent>
                    {(geo?.provinces ?? []).map((p) => (
                      <SelectItem key={p.province_id} value={p.province_name}>{p.province_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("District scope (optional)")}</Label>
                <Select value={form.district} onValueChange={(v) => setForm({ ...form, district: v ?? "" })} disabled={!form.province}>
                  <SelectTrigger><SelectValue placeholder={t("None")} /></SelectTrigger>
                  <SelectContent>
                    {(geo?.districts ?? []).filter((d) => d.province === form.province).map((d) => (
                      <SelectItem key={d.district_id} value={d.district}>{d.district}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("Cancel")}</Button>
            <Button disabled={saving || !form.fullName || !form.email || form.password.length < 8} onClick={createUser}>
              Create user
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
