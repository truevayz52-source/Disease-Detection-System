import { useMemo, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { Building2, MapPin, RefreshCw, Search, ShieldCheck } from "lucide-react"
import { SiteHeader } from "@/components/site-header"
import { StatCard } from "@/components/stat-card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api } from "@/lib/api"
import type { Facility } from "@/lib/types"
import { usePreferences } from "@/lib/preferences"

export default function AdminFacilitiesPage() {const{t}=usePreferences();
  const { data, mutate } = useSWR<{ items: Facility[] }>("/facilities", (u: string) => api(u))
  const { data: geo } = useSWR<{ provinces: { province_id: string; province_name: string }[]; districts: { district_id: string; province: string; district: string }[] }>("/facilities/geo", (u: string) => api(u))
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [provinceFilter, setProvinceFilter] = useState("all")
  const [form, setForm] = useState({ facilityName: "", province: "", district: "", latitude: "", longitude: "" })
  const [saving, setSaving] = useState(false)

  async function createFacility() {
    setSaving(true)
    try {
      await api("/facilities", {
        method: "POST",
        body: JSON.stringify({
          facilityName: form.facilityName,
          province: form.province,
          district: form.district,
          latitude: Number(form.latitude),
          longitude: Number(form.longitude),
        }),
      })
      toast.success(t("Facility registered."))
      setOpen(false)
      setForm({ facilityName: "", province: "", district: "", latitude: "", longitude: "" })
      mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed")
    } finally {
      setSaving(false)
    }
  }

  const valid =
    form.facilityName.trim().length >= 2 &&
    form.province.trim().length >= 2 &&
    form.district.trim().length >= 2 &&
    !Number.isNaN(Number(form.latitude)) &&
    !Number.isNaN(Number(form.longitude))

  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.items ?? []).filter((f) => {
      if (provinceFilter !== "all" && f.province !== provinceFilter) return false
      if (!q) return true
      return [f.facility_name, f.district, f.province, f.facility_type].some((v) => v?.toLowerCase().includes(q))
    })
  }, [data, search, provinceFilter])

  const stats = useMemo(() => {
    const all = data?.items ?? []
    return {
      total: all.length,
      provinces: new Set(all.map((f) => f.province)).size,
      central: all.filter((f) => /central|provincial/.test(f.facility_type)).length,
      clinics: all.filter((f) => /clinic|district|hospital$/.test(f.facility_type)).length,
    }
  }, [data])

  return (
    <>
      <SiteHeader title={t("Facilities")} />
      <div className="space-y-4 p-4 lg:p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label={t("Facilities")} value={stats.total} icon={Building2} color="blue" compact />
          <StatCard label={t("Provinces covered")} value={stats.provinces} icon={MapPin} color="emerald" compact />
          <StatCard label={t("Central / provincial")} value={stats.central} icon={ShieldCheck} color="purple" compact />
          <StatCard label={t("District / clinic")} value={stats.clinics} icon={Building2} color="amber" compact />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder={t("Search facility, district…")} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={provinceFilter} onValueChange={(v) => setProvinceFilter(v ?? "all")}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All provinces")}</SelectItem>
              {(geo?.provinces ?? []).map((p) => <SelectItem key={p.province_id} value={p.province_name}>{p.province_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => mutate()}><RefreshCw className="size-3.5" /> {t("Refresh")}</Button>
          <p className="ml-auto text-sm text-muted-foreground">{items.length} of {data?.items.length ?? 0} facilities</p>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Building2 className="size-4" /> Add facility
          </Button>
        </div>
        <Card className="shadow-lg">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Facility")}</TableHead>
                  <TableHead>{t("Type")}</TableHead>
                  <TableHead>{t("District")}</TableHead>
                  <TableHead>{t("Province")}</TableHead>
                  <TableHead>{t("Coordinates")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((f) => (
                  <TableRow key={f.facility_id}>
                    <TableCell className="font-medium">{f.facility_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{f.facility_type.replace(/_/g, " ")}</Badge>
                    </TableCell>
                    <TableCell>{f.district}</TableCell>
                    <TableCell>{f.province}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {Number(f.latitude).toFixed(4)}, {Number(f.longitude).toFixed(4)}
                    </TableCell>
                  </TableRow>
                ))}
                {!items.length && (
                  <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t("No facilities match your filters.")}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Register facility")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>{t("Facility name")}</Label>
              <Input value={form.facilityName} onChange={(e) => setForm({ ...form, facilityName: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("Province")}</Label>
                <Select value={form.province} onValueChange={(v) => setForm({ ...form, province: v ?? "", district: "" })}>
                  <SelectTrigger><SelectValue placeholder={t("Select province")} /></SelectTrigger>
                  <SelectContent>
                    {(geo?.provinces ?? []).map((p) => <SelectItem key={p.province_id} value={p.province_name}>{p.province_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("District")}</Label>
                <Select value={form.district} onValueChange={(v) => setForm({ ...form, district: v ?? "" })} disabled={!form.province}>
                  <SelectTrigger><SelectValue placeholder={t("Select district")} /></SelectTrigger>
                  <SelectContent>
                    {(geo?.districts ?? []).filter((d) => d.province === form.province).map((d) => <SelectItem key={d.district_id} value={d.district}>{d.district}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("Latitude")}</Label>
                <Input type="number" step="any" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} placeholder="-17.82" />
              </div>
              <div className="space-y-2">
                <Label>{t("Longitude")}</Label>
                <Input type="number" step="any" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} placeholder="31.05" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("Cancel")}</Button>
            <Button disabled={saving || !valid} onClick={createFacility}>{t("Register")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
