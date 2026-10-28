-- Remove the GPS tracking feature (web page, mobile screen and API endpoints
-- were deleted — the table and retention setting are no longer used).
DROP TABLE IF EXISTS gps_tracking;
DELETE FROM system_settings WHERE setting_key = 'gps_retention_days';
