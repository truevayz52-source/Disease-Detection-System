import { useMemo, useState } from "react"
import useSWR from "swr"
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip as LeafletTooltip } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import { SiteHeader } from "@/components/site-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { api } from "@/lib/api"
import { fmtDate } from "@/lib/format"
import { usePreferences } from "@/lib/preferences"

interface GeoData {
  facilities: {
    facility_id: string
    facility_name: string
    district: string
    province: string
    latitude: number
    longitude: number
    facility_type: string
  }[]
  cases: {
    notification_id: string
    date_of_death: string
    preliminary_icd_code: string
    disease_category: string
    latitude: number
    longitude: number
    district: string
  }[]
}

const CATEGORY_COLORS = [
  "#dc2626",
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#be185d",
  "#65a30d",
]

export default function AnalyticsMapPage() {const{t}=usePreferences();
  const { data } = useSWR<GeoData>("/analytics/geo", (u: string) => api(u))
  const [showCases, setShowCases] = useState(true)
  const [showFacilities, setShowFacilities] = useState(true)
  const [activeCategories, setActiveCategories] = useState<Set<string> | null>(null)

  const categories = useMemo(
    () => [...new Set((data?.cases ?? []).map((c) => c.disease_category))].sort(),
    [data],
  )
  const colorOf = useMemo(() => {
    const m = new Map<string, string>()
    categories.forEach((c, i) => m.set(c, CATEGORY_COLORS[i % CATEGORY_COLORS.length]))
    return (c: string) => m.get(c) ?? "#64748b"
  }, [categories])

  const visible = useMemo(() => {
    const cases = data?.cases ?? []
    if (!activeCategories) return cases
    return cases.filter((c) => activeCategories.has(c.disease_category))
  }, [data, activeCategories])

  function toggleCategory(c: string) {
    setActiveCategories((prev) => {
      const next = new Set(prev ?? categories)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  }

  return (
    <>
      <SiteHeader title={t("Outbreak Map")} />
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:p-6">
        <Card className="lg:w-72 shrink-0 self-start">
          <CardContent className="space-y-4 p-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={showFacilities} onCheckedChange={(v) => setShowFacilities(v === true)} />
                Facilities
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={showCases} onCheckedChange={(v) => setShowCases(v === true)} />
                Mortality cases ({visible.length})
              </label>
            </div>
            <div className="space-y-1.5 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">{t("Disease categories")}</p>
              {categories.map((c) => (
                <label key={c} className="flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={!activeCategories || activeCategories.has(c)}
                    onCheckedChange={() => toggleCategory(c)}
                  />
                  <span className="size-2.5 rounded-full" style={{ background: colorOf(c) }} />
                  {c}
                </label>
              ))}
            </div>
            <p className="border-t pt-3 text-[11px] text-muted-foreground">
              Cases are plotted at patient residence (or reporting facility when no address coordinates exist) — spatial
              clusters indicate possible outbreak zones.
            </p>
          </CardContent>
        </Card>

        <div className="min-h-[70vh] flex-1 overflow-hidden rounded-lg border">
          <MapContainer center={[-19.0, 29.8]} zoom={6} className="h-full w-full" style={{ minHeight: "70vh" }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">{t("OpenStreetMap")}</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {showFacilities &&
              (data?.facilities ?? []).map((f) => (
                <CircleMarker
                  key={f.facility_id}
                  center={[Number(f.latitude), Number(f.longitude)]}
                  radius={9}
                  pathOptions={{ color: ")#0f172a", weight: 1.5, fillColor: "#f8fafc", fillOpacity: 0.9 }}
                >
                  <LeafletTooltip direction="top" permanent={false}>
                    <strong>{f.facility_name}</strong>
                    <br />
                    {f.district}, {f.province}
                  </LeafletTooltip>
                </CircleMarker>
              ))}
            {showCases &&
              visible.map((c) => (
                <CircleMarker
                  key={c.notification_id}
                  center={[Number(c.latitude), Number(c.longitude)]}
                  radius={6}
                  pathOptions={{ color: colorOf(c.disease_category), weight: 1, fillColor: colorOf(c.disease_category), fillOpacity: 0.55 }}
                >
                  <Popup>
                    <div className="text-xs">
                      <Badge variant="secondary" className="mb-1 text-[10px]">{c.disease_category}</Badge>
                      <br />
                      ICD: <strong>{c.preliminary_icd_code}</strong>
                      <br />
                      District: {c.district}
                      <br />
                      Died: {fmtDate(c.date_of_death)}
                    </div>
                  </Popup>
                </CircleMarker>
              ))}
          </MapContainer>
        </div>
      </div>
    </>
  )
}
