-- PostgreSQL port of db/009-offline-lww.sql
-- Offline-first sync: last-write-wins provenance.
--
-- Mobile clients stamp every queued mutation with the device-side change
-- time (clientUpdatedAt). Update endpoints compare it against the row's
-- updated_at and return 409 {conflict: true} when a newer server write
-- already landed. client_updated_at is stored for audit/traceability.

ALTER TABLE death_notifications
  ADD COLUMN IF NOT EXISTS client_updated_at timestamptz;

ALTER TABLE autopsy_reports
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS client_updated_at timestamptz;

CREATE OR REPLACE TRIGGER trg_autopsy_reports_updated_at
  BEFORE UPDATE ON autopsy_reports FOR EACH ROW EXECUTE FUNCTION set_updated_at();
