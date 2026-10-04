import type { AuthUser } from "../auth/middleware.js"
import { query } from "../db.js"
export const facilityScoped = (user: AuthUser) => ["medical_officer", "mortuary_clerk"].includes(user.role)
export async function canAccessNotification(user: AuthUser, id: string, pathology = false) {
  if (user.role === "executive" || (pathology && user.role === "mortuary_clerk")) return false
  const [row] = await query<any[]>("SELECT facility_id FROM death_notifications WHERE notification_id = ?", [id])
  return Boolean(row && (!facilityScoped(user) || (user.facilityId && row.facility_id === user.facilityId)))
}
