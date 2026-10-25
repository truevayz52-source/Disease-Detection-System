import { useMemo, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { Building2, Loader2, LocateFixed, MapPin, Pencil, RefreshCw, Search, ShieldCheck } from "lucide-react"
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
  const { data: geo } = useSWR<{ provinces: { province_id: string; province_name: string }[]; districts: { district_id: string; province: string; district: string; lat: number; lng: number }[] }>("/facilities/geo", (u: string) => api(u))
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [provinceFilter, setProvinceFilter] = useState("all")
  const [typeFilter, setTypeFilter] = useState("all")
  const [form, setForm] = useState({ facilityName: "", province: "", district: "", latitude: "", longitude: "", facilityType: "district_hospital" })

  const FACILITY_TYPES = [
    "central_hospital","provincial_hospital","district_hospital","mission_hospital","general_hospital",
    "private_hospital","rural_health_clinic","specialist_clinic","clinic","laboratory",
    "head_office","provincial_office","district_office","administrative_office",
  ]

  function startEdit(f: Facility) {
    setEditingId(f.facility_id)
    setForm({
      facilityName: f.facility_name,
      province: f.province,
      district: f.district,
      latitude: String(f.latitude),
      longitude: String(f.longitude),
      facilityType: f.facility_type,
    })
    setOpen(true)
  }
  const [saving, setSaving] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [gpsFix, setGpsFix] = useState(false)

  function districtCentroid(district: string) {
    const d = geo?.districts.find((x) => x.district === district)
    return d && d.lat != null ? { lat: d.lat, lng: d.lng } : null
  }

  // Coordinates are auto-detected: device GPS first, district centre fallback.
  function detectLocation(showErrors = false) {
    const fallback = () =>
      setForm((f) => {
        const c = districtCentroid(f.district)
        return c ? { ...f, latitude: String(c.lat), longitude: String(c.lng) } : f
      })
    if (!("geolocation" in navigator)) {
      if (showErrors) toast.error(t("Geolocation is unavailable"))
      fallback()
      return
    }
    setDetecting(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsFix(true)
        setForm((f) => ({ ...f, latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) }))
        setDetecting(false)
      },
      () => {
        setDetecting(false)
        if (showErrors) toast.error(t("Geolocation is unavailable"))
        fallback()
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  async function saveFacility() {
    setSaving(true)
    const payload = {
      facilityName: form.facilityName,
      province: form.province,
      district: form.district,
      latitude: form.latitude === "" ? undefined : Number(form.latitude),
      longitude: form.longitude === "" ? undefined : Number(form.longitude),
      facilityType: form.facilityType,
    }
    try {
      if (editingId) {
        await api(`/facilities/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) })
        toast.success(t("Facility updated."))
      } else {
        await api("/facilities", { method: "POST", body: JSON.stringify(payload) })
        toast.success(t("Facility registered."))
      }
      setOpen(false)
      setEditingId(null)
      setForm({ facilityName: "", province: "", district: "", latitude: "", longitude: "", facilityType: "district_hospital" })
      setGpsFix(false)
      mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  const valid =
    form.facilityName.trim().length >= 2 &&
    form.province.trim().length >= 2 &&
    form.district.trim().length >= 2

  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.items ?? []).filter((f) => {
      if (provinceFilter !== "all" && f.province !== provinceFilter) return false
      if (typeFilter !== "all" && f.facility_type !== typeFilter) return false
      if (!q) return true
      return [f.facility_name, f.facility_code, f.district, f.province, f.facility_type].some((v) => v?.toLowerCase().includes(q))
    })
  }, [data, search, provinceFilter, typeFilter])

  // Render cap — 4k+ table rows would freeze the page; the search narrows it.
  const RENDER_LIMIT = 200
  const visible = items.slice(0, RENDER_LIMIT)

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
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v ?? "all")}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All types")}</SelectItem>
              {FACILITY_TYPES.map((ft) => <SelectItem key={ft} value={ft}>{ft.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => mutate()}><RefreshCw className="size-3.5" /> {t("Refresh")}</Button>
          <p className="ml-auto text-sm text-muted-foreground">
            {items.length > RENDER_LIMIT
              ? t("Showing {n} of {total} — search to narrow", { n: RENDER_LIMIT, total: items.length })
              : t("{n} of {total} facilities", { n: items.length, total: data?.items.length ?? 0 })}
          </p>
          <Button
            size="sm"
            onClick={() => {
              setEditingId(null)
              setForm({ facilityName: "", province: "", district: "", latitude: "", longitude: "", facilityType: "district_hospital" })
              setGpsFix(false)
              setOpen(true)
              detectLocation()
            }}
          >
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
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((f) => (
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
                    <TableCell>
                      <Button variant="ghost" size="icon" title={t("Edit facility")} onClick={() => startEdit(f)}>
                        <Pencil className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!items.length && (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("No facilities match your filters.")}</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? t("Edit facility") : t("Register facility")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>{t("Facility name")}</Label>
              <Input value={form.facilityName} onChange={(e) => setForm({ ...form, facilityName: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>{t("Facility type")}</Label>
              <Select value={form.facilityType} onValueChange={(v) => setForm({ ...form, facilityType: v ?? "district_hospital" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FACILITY_TYPES.map((ft) => <SelectItem key={ft} value={ft}>{ft.replace(/_/g, " ")}</SelectItem>)}
                </SelectContent>
              </Select>
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
                <Select
                  value={form.district}
                  onValueChange={(v) => {
                    const d = v ?? ""
                    setForm((f) => {
                      const upd = { ...f, district: d }
                      // No device fix yet — pre-fill the district centre so
                      // coordinates are never typed by hand.
                      if (!gpsFix) {
                        const c = districtCentroid(d)
                        if (c) {
                          upd.latitude = String(c.lat)
                          upd.longitude = String(c.lng)
                        }
                      }
                      return upd
                    })
                  }}
                  disabled={!form.province}
                >
                  <SelectTrigger><SelectValue placeholder={t("Select district")} /></SelectTrigger>
                  <SelectContent>
                    {(geo?.districts ?? []).filter((d) => d.province === form.province).map((d) => <SelectItem key={d.district_id} value={d.district}>{d.district}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t("Coordinates")}</Label>
                <Button type="button" variant="outline" size="sm" disabled={detecting} onClick={() => detectLocation(true)}>
                  {detecting ? <Loader2 className="size-3.5 animate-spin" /> : <LocateFixed className="size-3.5" />}
                  {t("Detect location")}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input type="number" step="any" value={form.latitude} onChange={(e) => { setGpsFix(false); setForm({ ...form, latitude: e.target.value }) }} placeholder="-17.82" aria-label={t("Latitude")} />
                <Input type="number" step="any" value={form.longitude} onChange={(e) => { setGpsFix(false); setForm({ ...form, longitude: e.target.value }) }} placeholder="31.05" aria-label={t("Longitude")} />
              </div>
              <p className="text-xs text-muted-foreground">
                {gpsFix
                  ? t("Detected from this device's GPS.")
                  : t("Auto-filled from the district centre — press Detect location while at the facility for an exact GPS fix.")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditingId(null) }}>{t("Cancel")}</Button>
            <Button disabled={saving || !valid} onClick={saveFacility}>{editingId ? t("Save changes") : t("Register")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
