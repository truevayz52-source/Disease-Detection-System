-- Offline-first sync: last-write-wins provenance.
--
-- Mobile clients stamp every queued mutation with the device-side change
-- time (`clientUpdatedAt`). Update endpoints compare it against the row's
-- `updated_at` and return 409 {conflict: true} when a newer server write
-- already landed. `client_updated_at` is stored for audit/traceability.
-- `updated_at` remains the comparison column — it already auto-maintains on
-- death_notifications; autopsy_reports gains it here (finalize bumps it).

ALTER TABLE `death_notifications`
  ADD COLUMN `client_updated_at` DATETIME NULL;

ALTER TABLE `autopsy_reports`
  ADD COLUMN `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ADD COLUMN `client_updated_at` DATETIME NULL;
