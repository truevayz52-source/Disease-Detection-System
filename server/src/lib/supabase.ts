import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { config } from "../config.js"
import { query } from "../db.js"

// ---------------------------------------------------------------------------
// Supabase integration (Phase 2 — hybrid auth).
//
// supabaseAdmin() returns null until SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// are configured, so the whole hybrid path silently disables for local dev or
// a plain Postgres deployment. The service-role key never leaves the server.
// ---------------------------------------------------------------------------

let adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient | null {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) return null
  adminClient ??= createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return adminClient
}

/**
 * Lazy account migration: after a legacy Argon2 login succeeds, link the app
 * user to a Supabase Auth identity. Existing auth.users rows are reused;
 * otherwise a confirmed user is created with the same password. Failures are
 * logged and swallowed — the legacy session is still issued either way, and
 * the next successful login retries.
 */
export async function linkSupabaseAuthUser(
  user: { user_id: string; email: string; full_name: string; role: string; auth_user_id?: string | null },
  password: string,
): Promise<void> {
  if (user.auth_user_id) return
  const admin = supabaseAdmin()
  if (!admin) return
  try {
    // Postgres lets us look up auth.users directly; on a local DB without the
    // auth schema this simply returns no rows.
    const existing = await query<any[]>("SELECT id FROM auth.users WHERE email = ?", [user.email]).catch(() => [] as any[])
    let authUserId: string | null = existing[0]?.id ?? null
    if (!authUserId) {
      const { data, error } = await admin.auth.admin.createUser({
        email: user.email,
        password,
        email_confirm: true,
        user_metadata: { name: user.full_name, role: user.role },
      })
      if (error || !data.user?.id) {
        console.warn("[auth] Supabase account link failed:", error?.message ?? "no user returned")
        return
      }
      authUserId = data.user.id
    }
    await query("UPDATE users SET auth_user_id = ? WHERE user_id = ? AND auth_user_id IS NULL", [authUserId, user.user_id])
  } catch (err) {
    console.warn("[auth] Supabase account link failed:", err instanceof Error ? err.message : err)
  }
}
