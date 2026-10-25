-- Phase 2 hybrid auth: link application users to Supabase Auth identities.
-- Column + index only - no FK to auth.users(id), so this migration also
-- applies on a plain local Postgres that has no auth schema.
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_user_id uuid;
CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON users (auth_user_id);
