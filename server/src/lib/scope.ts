import type { AuthUser } from "../auth/middleware.js"

/**
 * Port of BIIMZim `scope_clause()` (backend/public/index.php) adapted to DDS
 * roles. Builds a WHERE fragment + params restricting rows to the caller's
 * territorial scope:
 *   - national roles          → see everything
 *   - user with province set  → province scope (plus district when set)
 *   - otherwise               → own facility only
 * Falls back to facility scoping when province/district are unset — a safe
 * default since facilities carry their own district/province anyway.
 */
const NATIONAL_ROLES = new Set(["system_admin", "executive", "public_health_analyst"])

export function scopeWhere(
  user: AuthUser,
  alias = "",
  columns: { province?: string; district?: string; facilityId?: string } = {},
): { where: string; params: any[] } {
  if (NATIONAL_ROLES.has(user.role)) return { where: "", params: [] }

  const p = alias ? `${alias}.` : ""
  const provinceCol = columns.province ?? "province"
  const districtCol = columns.district ?? "district"
  const facilityCol = columns.facilityId ?? "facility_id"

  const parts: string[] = []
  const params: any[] = []

  // District-level: all rows within the user's district (inside their province when set)
  if (user.district && user.district !== "All districts") {
    if (user.province && user.province !== "National") {
      parts.push(`${p}${provinceCol} = ?`)
      params.push(user.province)
    }
    parts.push(`${p}${districtCol} = ?`)
    params.push(user.district)
    return { where: parts.join(" AND "), params }
  }

  // Provincial-level: all districts/facilities in the user's province
  if (user.province && user.province !== "National") {
    parts.push(`${p}${provinceCol} = ?`)
    params.push(user.province)
    return { where: parts.join(" AND "), params }
  }

  // Facility-level (VHW equivalent): own facility's rows only
  if (user.facilityId) {
    parts.push(`${p}${facilityCol} = ?`)
    params.push(user.facilityId)
    return { where: parts.join(" AND "), params }
  }

  // No scope attributes — restrict to nothing rather than leak everything
  return { where: "1 = 0", params: [] }
}
