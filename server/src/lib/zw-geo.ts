// Zimbabwe geographic reference — province/district centroids used to
// auto-resolve facility coordinates so users never have to type lat/lng.

export interface GeoPoint {
  lat: number
  lng: number
}

export const PROVINCE_COORDINATES: Record<string, GeoPoint> = {
  harare: { lat: -17.8292, lng: 31.0522 },
  bulawayo: { lat: -20.15, lng: 28.5833 },
  manicaland: { lat: -18.9707, lng: 32.6709 },
  "mashonaland central": { lat: -17.3, lng: 31.3333 },
  "mashonaland east": { lat: -18.1833, lng: 31.55 },
  "mashonaland west": { lat: -17.3667, lng: 30.2 },
  masvingo: { lat: -20.0636, lng: 30.8277 },
  matabeleland_north: { lat: -18.9317, lng: 27.807 },
  "matabeleland north": { lat: -18.9317, lng: 27.807 },
  matabeleland_south: { lat: -20.9333, lng: 29.0 },
  "matabeleland south": { lat: -20.9333, lng: 29.0 },
  midlands: { lat: -19.45, lng: 29.8167 },
}

export const DISTRICT_COORDINATES: Record<string, GeoPoint> = {
  // Harare
  harare: { lat: -17.8292, lng: 31.0522 },
  chitungwiza: { lat: -18.0128, lng: 31.0756 },
  epworth: { lat: -17.89, lng: 31.1475 },
  ruwa: { lat: -17.8897, lng: 31.2447 },
  // Bulawayo
  "bulawayo central": { lat: -20.15, lng: 28.5833 },
  "bulawayo north": { lat: -20.1167, lng: 28.5833 },
  "bulawayo south": { lat: -20.1833, lng: 28.5833 },
  emakhandeni: { lat: -20.1333, lng: 28.5333 },
  nkulumane: { lat: -20.2, lng: 28.5167 },
  "northern suburbs": { lat: -20.1, lng: 28.6167 },
  // Manicaland
  buhera: { lat: -19.3167, lng: 31.4333 },
  chimanimani: { lat: -19.8, lng: 32.8667 },
  chipinge: { lat: -20.1833, lng: 32.6167 },
  makoni: { lat: -18.5333, lng: 32.1333 },
  mutare: { lat: -18.9707, lng: 32.6709 },
  mutasa: { lat: -18.6167, lng: 32.6833 },
  nyanga: { lat: -18.2167, lng: 32.75 },
  // Mashonaland Central
  bindura: { lat: -17.3, lng: 31.3333 },
  guruve: { lat: -16.6667, lng: 30.7 },
  mazowe: { lat: -17.5167, lng: 30.9833 },
  "mount darwin": { lat: -16.7833, lng: 31.5833 },
  "mt darwin": { lat: -16.7833, lng: 31.5833 },
  muzarabani: { lat: -16.3667, lng: 31.0167 },
  rushinga: { lat: -16.6667, lng: 32.3333 },
  shamva: { lat: -17.1833, lng: 31.5667 },
  // Mashonaland East
  marondera: { lat: -18.1833, lng: 31.55 },
  chikomba: { lat: -19.0, lng: 31.1667 },
  goromonzi: { lat: -17.8167, lng: 31.3833 },
  hwedza: { lat: -18.6167, lng: 31.5667 },
  wedza: { lat: -18.6167, lng: 31.5667 },
  mudzi: { lat: -17.15, lng: 32.5833 },
  murehwa: { lat: -17.65, lng: 31.7833 },
  mutoko: { lat: -17.4, lng: 32.2333 },
  seke: { lat: -18.0167, lng: 31.1333 },
  ump: { lat: -17.0833, lng: 32.0833 },
  // Mashonaland West
  chinhoyi: { lat: -17.3667, lng: 30.2 },
  chegutu: { lat: -18.1333, lng: 30.15 },
  hurungwe: { lat: -16.8167, lng: 29.6833 },
  kariba: { lat: -16.5167, lng: 28.8 },
  makonde: { lat: -17.3667, lng: 30.0 },
  "mhondoro-ngezi": { lat: -18.6, lng: 30.4 },
  sanyati: { lat: -17.95, lng: 29.3 },
  zvimba: { lat: -17.7167, lng: 30.45 },
  // Masvingo
  masvingo: { lat: -20.0636, lng: 30.8277 },
  bikita: { lat: -19.9667, lng: 31.6167 },
  chiredzi: { lat: -21.05, lng: 31.6667 },
  chivi: { lat: -20.3, lng: 30.5 },
  gutu: { lat: -19.65, lng: 31.1667 },
  mwenezi: { lat: -21.4167, lng: 30.7333 },
  zaka: { lat: -20.35, lng: 31.45 },
  // Midlands
  gweru: { lat: -19.45, lng: 29.8167 },
  chirumhanzu: { lat: -19.4167, lng: 30.3667 },
  "gokwe north": { lat: -17.8, lng: 28.9333 },
  "gokwe south": { lat: -18.2167, lng: 28.9333 },
  kwekwe: { lat: -18.9333, lng: 29.8167 },
  mberengwa: { lat: -20.4833, lng: 29.9167 },
  shurugwi: { lat: -19.6667, lng: 30.0 },
  zvishavane: { lat: -20.3333, lng: 30.0667 },
  // Matabeleland North
  lupane: { lat: -18.9317, lng: 27.807 },
  binga: { lat: -17.6167, lng: 27.3333 },
  bubi: { lat: -19.5333, lng: 28.75 },
  hwange: { lat: -18.3667, lng: 26.5 },
  nkayi: { lat: -19.0, lng: 28.9 },
  tsholotsho: { lat: -19.7667, lng: 27.75 },
  umguza: { lat: -20.05, lng: 28.6 },
  // Matabeleland South
  gwanda: { lat: -20.9333, lng: 29.0 },
  beitbridge: { lat: -22.2167, lng: 30.0 },
  bulilima: { lat: -20.05, lng: 27.8167 },
  insiza: { lat: -20.0333, lng: 29.3333 },
  mangwe: { lat: -20.7, lng: 28.05 },
  matobo: { lat: -20.5833, lng: 28.4667 },
  umzingwane: { lat: -20.3, lng: 28.9333 },
}

const DEFAULT_CENTER: GeoPoint = { lat: -17.8292, lng: 31.0522 } // Harare

/** Best-known centroid for a district (falls back to province, then Harare). */
export function districtCenter(district: string, province: string): GeoPoint {
  return (
    DISTRICT_COORDINATES[district.toLowerCase().trim()] ??
    PROVINCE_COORDINATES[province.toLowerCase().trim()] ??
    DEFAULT_CENTER
  )
}

function hashSeed(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * Auto-resolve a facility's coordinates without user input: district centroid
 * plus a deterministic golden-angle spread keyed on `seed` so multiple
 * facilities in the same district don't stack on one map point.
 */
export function resolveFacilityCoords(district: string, province: string, seed: string): GeoPoint {
  const center = districtCenter(district, province)
  const n = hashSeed(seed)
  const angle = ((n % 360) * 137.5 * Math.PI) / 180
  const radius = 0.01 + ((n % 50) / 50) * 0.06 // ~1–7 km from district centre
  return {
    lat: Number((center.lat + Math.sin(angle) * radius).toFixed(6)),
    lng: Number((center.lng + Math.cos(angle) * radius).toFixed(6)),
  }
}
