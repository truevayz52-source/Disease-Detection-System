import { useCallback, useMemo, useRef, useState } from "react"
import useSWR from "swr"
import MapGL, { Layer, Popup, Source, type MapMouseEvent, type MapRef } from "react-map-gl/maplibre"
import "maplibre-gl/dist/maplibre-gl.css"
import { setWorkerUrl, type CircleLayerSpecification, type MapGeoJSONFeature } from "maplibre-gl"
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url"

// maplibre resolves its worker relative to import.meta.url, which breaks
// under both Vite pre-bundling and asset hashing — pin it explicitly.
setWorkerUrl(maplibreWorkerUrl)
import { SiteHeader } from "@/components/site-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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

// OpenFreeMap vector styles — free, no API key. Positron keeps the old
// light-grey-canvas look regardless of app theme.
const OPENFREEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'

const FACILITY_PAINT: CircleLayerSpecification["paint"] = {
  "circle-radius": 9,
  "circle-color": "#f8fafc",
  "circle-opacity": 0.9,
  "circle-stroke-color": "#0f172a",
  "circle-stroke-width": 1.5,
}

const CASE_PAINT: CircleLayerSpecification["paint"] = {
  "circle-radius": 6,
  "circle-color": ["get", "color"],
  "circle-opacity": 0.55,
  "circle-stroke-color": ["get", "color"],
  "circle-stroke-width": 1,
}

// Amber ring marking a facility picked via the province/district finder —
// drawn even when the facilities layer is off so the selection is visible.
const SELECTED_FACILITY_PAINT: CircleLayerSpecification["paint"] = {
  "circle-radius": 13,
  "circle-color": "#f59e0b",
  "circle-opacity": 0.35,
  "circle-stroke-color": "#b45309",
  "circle-stroke-width": 2,
}

type Facility = GeoData["facilities"][number]

interface PopupInfo {
  lng: number
  lat: number
  kind: "case" | "facility"
  props: Record<string, string>
}

export default function AnalyticsMapPage() {const{t}=usePreferences();
  const { data } = useSWR<GeoData>("/analytics/geo", (u: string) => api(u))
  const [showCases, setShowCases] = useState(true)
  const [showFacilities, setShowFacilities] = useState(false)
  const [activeCategories, setActiveCategories] = useState<Set<string> | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [popup, setPopup] = useState<PopupInfo | null>(null)
  const [hover, setHover] = useState<PopupInfo | null>(null)
  const mapRef = useRef<MapRef>(null)

  // Facility finder: province → district → name search.
  const [province, setProvince] = useState("")
  const [district, setDistrict] = useState("")
  const [facilitySearch, setFacilitySearch] = useState("")
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null)

  const facilities = useMemo(() => data?.facilities ?? [], [data])
  const provinces = useMemo(
    () => [...new Set(facilities.map((f) => f.province))].sort(),
    [facilities],
  )
  const districts = useMemo(
    () => [...new Set(facilities.filter((f) => f.province === province).map((f) => f.district))].sort(),
    [facilities, province],
  )
  const matchedFacilities = useMemo(() => {
    const q = facilitySearch.trim().toLowerCase()
    return facilities
      .filter((f) => f.province === province)
      .filter((f) => !district || f.district === district)
      .filter((f) => !q || f.facility_name.toLowerCase().includes(q))
      .slice(0, 15)
  }, [facilities, province, district, facilitySearch])

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

  const facilitiesGeo = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: (data?.facilities ?? [])
        .filter((f) => Number.isFinite(Number(f.latitude)) && Number.isFinite(Number(f.longitude)))
        .map((f) => ({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [Number(f.longitude), Number(f.latitude)],
          },
          properties: {
            name: f.facility_name,
            district: f.district,
            province: f.province,
          },
        })),
    }),
    [data],
  )

  const casesGeo = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: visible
        .filter((c) => Number.isFinite(Number(c.latitude)) && Number.isFinite(Number(c.longitude)))
        .map((c) => ({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [Number(c.longitude), Number(c.latitude)],
          },
          properties: {
            category: c.disease_category,
            color: colorOf(c.disease_category),
            icd: c.preliminary_icd_code,
            district: c.district,
            died: c.date_of_death,
          },
        })),
    }),
    [visible, colorOf],
  )

  const pointOf = useCallback((f: MapGeoJSONFeature): PopupInfo | null => {
    if (f.geometry.type !== "Point") return null
    const [lng, lat] = f.geometry.coordinates
    return {
      lng,
      lat,
      kind: f.layer?.id === "case-points" ? "case" : "facility",
      props: (f.properties ?? {}) as Record<string, string>,
    }
  }, [])

  const onMapClick = useCallback(
    (e: MapMouseEvent) => {
      // Prefer the case dot under the cursor when markers overlap.
      const f = e.features?.find((f) => f.layer.id === "case-points") ?? e.features?.[0]
      setPopup(f ? pointOf(f) : null)
    },
    [pointOf],
  )

  const onMapMove = useCallback(
    (e: MapMouseEvent) => {
      const f = e.features?.find((f) => f.layer.id === "facility-points")
      setHover(f ? pointOf(f) : null)
    },
    [pointOf],
  )

  function selectFacility(f: Facility) {
    setSelectedFacility(f)
    const lng = Number(f.longitude)
    const lat = Number(f.latitude)
    const zoom = mapRef.current?.getZoom() ?? 6
    mapRef.current?.flyTo({ center: [lng, lat], zoom: Math.max(zoom, 11), duration: 1200 })
    setPopup({
      lng,
      lat,
      kind: "facility",
      props: { name: f.facility_name, district: f.district, province: f.province },
    })
  }

  function toggleCategory(c: string) {
    setActiveCategories((prev) => {
      const next = new Set(prev ?? categories)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })
  }

  const interactiveLayers = useMemo(
    () =>
      mapLoaded
        ? ([showFacilities && "facility-points", showCases && "case-points"].filter(Boolean) as string[])
        : [],
    [mapLoaded, showFacilities, showCases],
  )

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
            <div className="space-y-2 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">{t("Find facility")}</p>
              <Select
                value={province}
                onValueChange={(v) => {
                  setProvince(v ?? "")
                  setDistrict("")
                  setFacilitySearch("")
                  setSelectedFacility(null)
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("Province")} />
                </SelectTrigger>
                <SelectContent>
                  {provinces.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {province && (
                <>
                  <Select
                    value={district || "all"}
                    onValueChange={(v) => {
                      setDistrict(!v || v === "all" ? "" : v)
                      setFacilitySearch("")
                      setSelectedFacility(null)
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("District")}>
                        {(v) => (v === "all" ? t("All districts") : v)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("All districts")}</SelectItem>
                      {districts.map((d) => (
                        <SelectItem key={d} value={d}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={facilitySearch}
                    onChange={(e) => setFacilitySearch(e.target.value)}
                    placeholder={t("Search facility name…")}
                  />
                  <div className="max-h-44 divide-y overflow-y-auto rounded-md border text-xs">
                    {matchedFacilities.map((f) => (
                      <button
                        key={f.facility_id}
                        type="button"
                        onClick={() => selectFacility(f)}
                        className={`block w-full px-2 py-1.5 text-left hover:bg-accent ${
                          selectedFacility?.facility_id === f.facility_id ? "bg-accent" : ""
                        }`}
                      >
                        <span className="block truncate font-medium">{f.facility_name}</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {f.district} · {f.facility_type.replace(/_/g, " ")}
                        </span>
                      </button>
                    ))}
                    {matchedFacilities.length === 0 && (
                      <p className="px-2 py-1.5 text-muted-foreground">{t("No facilities found")}</p>
                    )}
                  </div>
                </>
              )}
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
          <MapGL
            ref={mapRef}
            initialViewState={{ latitude: -19.0, longitude: 29.8, zoom: 6 }}
            mapStyle="https://tiles.openfreemap.org/styles/positron"
            style={{ width: "100%", height: "100%", minHeight: "70vh" }}
            attributionControl={{ customAttribution: OPENFREEMAP_ATTRIBUTION }}
            interactiveLayerIds={interactiveLayers}
            onClick={onMapClick}
            onMouseMove={onMapMove}
            onLoad={() => setMapLoaded(true)}
          >
            {showFacilities && (
              <Source id="facilities" type="geojson" data={facilitiesGeo}>
                <Layer id="facility-points" type="circle" paint={FACILITY_PAINT} />
              </Source>
            )}
            {showCases && (
              <Source id="cases" type="geojson" data={casesGeo}>
                <Layer id="case-points" type="circle" paint={CASE_PAINT} />
              </Source>
            )}
            {selectedFacility && (
              <Source
                id="selected-facility"
                type="geojson"
                data={{
                  type: "Feature",
                  geometry: {
                    type: "Point",
                    coordinates: [Number(selectedFacility.longitude), Number(selectedFacility.latitude)],
                  },
                  properties: {},
                }}
              >
                <Layer id="selected-facility-ring" type="circle" paint={SELECTED_FACILITY_PAINT} />
              </Source>
            )}

            {hover && !popup && (
              <Popup
                longitude={hover.lng}
                latitude={hover.lat}
                closeButton={false}
                closeOnClick={false}
                anchor="bottom"
                offset={12}
              >
                <div className="text-xs">
                  <strong>{hover.props.name}</strong>
                  <br />
                  {hover.props.district}, {hover.props.province}
                </div>
              </Popup>
            )}
            {popup && (
              <Popup
                longitude={popup.lng}
                latitude={popup.lat}
                closeButton
                closeOnClick={false}
                onClose={() => setPopup(null)}
                anchor="bottom"
                offset={12}
              >
                {popup.kind === "case" ? (
                  <div className="text-xs">
                    <Badge variant="secondary" className="mb-1 text-[10px]">{popup.props.category}</Badge>
                    <br />
                    ICD: <strong>{popup.props.icd}</strong>
                    <br />
                    District: {popup.props.district}
                    <br />
                    Died: {fmtDate(popup.props.died)}
                  </div>
                ) : (
                  <div className="text-xs">
                    <strong>{popup.props.name}</strong>
                    <br />
                    {popup.props.district}, {popup.props.province}
                  </div>
                )}
              </Popup>
            )}
          </MapGL>
        </div>
      </div>
    </>
  )
}
