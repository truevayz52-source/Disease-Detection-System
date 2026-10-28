import { config } from "../config.js"

// Basemap tile resolver for the Leaflet (web) and flutter_map (mobile)
// surveillance maps. Both clients consume the same {z}/{x}/{y} raster
// template from GET /api/config/map — no Google SDK, no manifest changes.

export interface MapTileConfig {
  provider: string
  urlTemplate: string
  subdomains: string[]
  attribution: string
  /** Epoch ms when urlTemplate stops working (Map Tiles API session). */
  expiresAt?: number
}

const GOOGLE_SUBDOMAINS = ["mt0", "mt1", "mt2", "mt3"]
const GOOGLE_ATTRIBUTION = "Imagery © Google · Map data ©2026 Google"
const ESRI_ATTRIBUTION =
  'Tiles © <a href="https://www.esri.com/">Esri</a> · Source: Esri, Maxar, Earthstar Geographics · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// lyrs= codes on the Google tile CDN (same tiles Google Maps renders).
const GOOGLE_LYRS: Record<string, string> = {
  hybrid: "y", // satellite + road labels
  satellite: "s",
  roadmap: "m",
  terrain: "p",
}

function googleHybridConfig(): MapTileConfig {
  const lyrs = GOOGLE_LYRS[config.mapTileStyle] ?? "y"
  return {
    provider: "google-hybrid",
    urlTemplate: `https://mt{s}.google.com/vt/lyrs=${lyrs}&hl=en&x={x}&y={y}&z={z}`,
    subdomains: GOOGLE_SUBDOMAINS,
    attribution: GOOGLE_ATTRIBUTION,
  }
}

function esriConfig(imagery: boolean): MapTileConfig {
  return {
    provider: imagery ? "esri-imagery" : "esri-canvas",
    urlTemplate: imagery
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    subdomains: [],
    attribution: ESRI_ATTRIBUTION,
  }
}

interface MapTilesSession {
  token: string
  /** Epoch ms — refreshed when now > expiry - margin. */
  expiry: number
}

let sessionCache: MapTilesSession | null = null
let sessionWarned = false

// Official Google Map Tiles API: createSession returns a token good for
// ~2 weeks; tiles then authenticate with session + key. Requires the Map
// Tiles API enabled + billing on the key's project (free monthly tier).
async function createMapTilesSession(): Promise<MapTilesSession | null> {
  const key = config.googleMapsApiKey
  if (!key) return null
  try {
    const satellite = config.mapTileStyle === "hybrid" || config.mapTileStyle === "satellite"
    const res = await fetch(`https://tile.googleapis.com/v1/createSession?key=${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mapType: satellite ? "satellite" : config.mapTileStyle === "terrain" ? "terrain" : "roadmap",
        // layerRoadmap turns satellite tiles into hybrid (imagery + labels).
        ...(config.mapTileStyle === "hybrid" ? { layerTypes: ["layerRoadmap"] } : {}),
        language: "en",
        region: "ZW",
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`createSession -> ${res.status}`)
    const data = (await res.json()) as { session?: string; expiry?: string }
    if (!data.session) throw new Error("createSession returned no session token")
    // expiry is seconds since epoch; refresh an hour early.
    const expiry = data.expiry ? Number(data.expiry) * 1000 : Date.now() + 14 * 24 * 3600_000
    return { token: data.session, expiry }
  } catch (error) {
    if (!sessionWarned) {
      sessionWarned = true
      console.warn(
        `[map-tiles] Map Tiles API session failed (${error instanceof Error ? error.message : error}); ` +
          "falling back to google-hybrid tiles. Enable the Map Tiles API + billing on the key's project to use the official path.",
      )
    }
    return null
  }
}

async function mapTilesApiConfig(): Promise<MapTileConfig | null> {
  const margin = 3600_000
  if (!sessionCache || Date.now() > sessionCache.expiry - margin) {
    sessionCache = await createMapTilesSession()
  }
  if (!sessionCache) return null
  return {
    provider: "google-maptiles",
    urlTemplate: `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${sessionCache.token}&key=${config.googleMapsApiKey}`,
    subdomains: [],
    attribution: GOOGLE_ATTRIBUTION,
    expiresAt: sessionCache.expiry - margin,
  }
}

/** Resolve the active basemap config; result is safe to send to clients. */
export async function resolveMapTiles(): Promise<MapTileConfig> {
  switch (config.mapProvider) {
    case "google-maptiles":
      return (await mapTilesApiConfig()) ?? googleHybridConfig()
    case "google-hybrid":
      return googleHybridConfig()
    case "esri-imagery":
      return esriConfig(true)
    case "esri-canvas":
      return esriConfig(false)
    default:
      // Auto: official tiles when the key works, key-free hybrid otherwise —
      // the map renders today at $0 and upgrades itself once the Map Tiles
      // API is enabled on the project.
      return (await mapTilesApiConfig()) ?? googleHybridConfig()
  }
}
