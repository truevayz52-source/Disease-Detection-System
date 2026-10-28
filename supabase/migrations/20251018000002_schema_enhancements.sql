-- Disease Detection System (DDS) Schema Enhancements (PostgreSQL port of
-- db/002-schema-enhancements.sql) - 6 roles, advanced features.

-- ---------------------------------------------------------------------------
-- New Tables for Enhanced Features
-- ---------------------------------------------------------------------------

-- Offline sync queue for IndexedDB persistence
CREATE TABLE IF NOT EXISTS offline_sync_queue (
  queue_id varchar(36) PRIMARY KEY,
  user_id varchar(36) NOT NULL,
  entity_type varchar(50) NOT NULL,
  entity_data jsonb NOT NULL,
  sync_status varchar(20) NOT NULL DEFAULT 'pending',
  sync_attempts integer NOT NULL DEFAULT 0,
  last_sync_attempt timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz,
  CONSTRAINT fk_queue_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_queue_user_status ON offline_sync_queue (user_id, sync_status);

-- MPDSR workflow tracking
CREATE TABLE IF NOT EXISTS mpdsr_workflows (
  workflow_id varchar(36) PRIMARY KEY,
  notification_id varchar(36) NOT NULL,
  initiated_by varchar(36) NOT NULL,
  department_notified varchar(255),
  notification_timestamp timestamptz,
  response_status varchar(50) DEFAULT 'pending',
  investigation_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_mpdsr_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id) ON DELETE CASCADE,
  CONSTRAINT fk_mpdsr_user FOREIGN KEY (initiated_by) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_mpdsr_notification ON mpdsr_workflows (notification_id);
CREATE OR REPLACE TRIGGER trg_mpdsr_workflows_updated_at
  BEFORE UPDATE ON mpdsr_workflows FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- AI pathology pre-screening results
CREATE TABLE IF NOT EXISTS ai_pathology_analysis (
  analysis_id varchar(36) PRIMARY KEY,
  image_id varchar(36) NOT NULL,
  notification_id varchar(36) NOT NULL,
  model_version varchar(50) NOT NULL,
  anomaly_score decimal(5,4) NOT NULL,
  anomaly_regions jsonb,
  confidence_score decimal(5,4),
  analysis_timestamp timestamptz NOT NULL DEFAULT now(),
  reviewed_by varchar(36),
  reviewed_at timestamptz,
  CONSTRAINT fk_ai_image FOREIGN KEY (image_id) REFERENCES tele_pathology_images(image_id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_image ON ai_pathology_analysis (image_id);
CREATE INDEX IF NOT EXISTS idx_ai_notification ON ai_pathology_analysis (notification_id);

-- Predictive resource allocation forecasts
CREATE TABLE IF NOT EXISTS resource_forecasts (
  forecast_id varchar(36) PRIMARY KEY,
  district varchar(100) NOT NULL,
  disease_category varchar(100) NOT NULL,
  forecast_horizon_days integer NOT NULL,
  predicted_cases integer NOT NULL,
  recommended_supplies jsonb,
  confidence_level decimal(5,4),
  forecast_generated_at timestamptz NOT NULL DEFAULT now(),
  forecast_target_date timestamptz NOT NULL,
  actual_cases integer,
  actual_outcome timestamptz
);
CREATE INDEX IF NOT EXISTS idx_forecast_district ON resource_forecasts (district);
CREATE INDEX IF NOT EXISTS idx_forecast_target ON resource_forecasts (forecast_target_date);

-- Custom alert threshold configurations
CREATE TABLE IF NOT EXISTS alert_thresholds (
  threshold_id varchar(36) PRIMARY KEY,
  configured_by varchar(36) NOT NULL,
  district varchar(100),
  disease_category varchar(100),
  case_threshold integer NOT NULL,
  time_window_hours integer NOT NULL,
  spatial_radius_km decimal(10,2),
  alert_priority varchar(20) DEFAULT 'normal',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_threshold_user FOREIGN KEY (configured_by) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_threshold_active ON alert_thresholds (is_active);
CREATE OR REPLACE TRIGGER trg_alert_thresholds_updated_at
  BEFORE UPDATE ON alert_thresholds FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Cross-border disease tracking
CREATE TABLE IF NOT EXISTS cross_border_cases (
  cross_border_id varchar(36) PRIMARY KEY,
  notification_id varchar(36) NOT NULL,
  source_country varchar(100) NOT NULL,
  border_crossing_point varchar(255),
  travel_history text,
  cluster_reference_id varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_cross_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id)
);
CREATE INDEX IF NOT EXISTS idx_cross_country ON cross_border_cases (source_country);

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_id varchar(36) PRIMARY KEY,
  user_id varchar(36) NOT NULL,
  token_hash varchar(128) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_reset_token ON password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens (user_id);

-- Real-time notifications
CREATE TABLE IF NOT EXISTS user_notifications (
  notification_id varchar(36) PRIMARY KEY,
  user_id varchar(36) NOT NULL,
  notification_type varchar(50) NOT NULL,
  title varchar(255) NOT NULL,
  message text,
  action_url varchar(512),
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notification_user_read ON user_notifications (user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notification_created ON user_notifications (created_at);

-- Two-factor authentication
CREATE TABLE IF NOT EXISTS two_factor_auth (
  tfa_id varchar(36) PRIMARY KEY,
  user_id varchar(36) NOT NULL,
  secret_key varchar(255) NOT NULL,
  backup_codes jsonb,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_tfa_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tfa_user ON two_factor_auth (user_id);

-- Blockchain audit trail (immutable records)
CREATE TABLE IF NOT EXISTS blockchain_audit (
  block_id varchar(36) PRIMARY KEY,
  previous_hash varchar(128) NOT NULL,
  block_hash varchar(128) NOT NULL,
  audit_data jsonb NOT NULL,
  "timestamp" timestamptz NOT NULL DEFAULT now(),
  mined_by varchar(36)
);
CREATE INDEX IF NOT EXISTS idx_blockchain_hash ON blockchain_audit (block_hash);
CREATE INDEX IF NOT EXISTS idx_blockchain_timestamp ON blockchain_audit ("timestamp");

-- Comments and collaboration
CREATE TABLE IF NOT EXISTS entity_comments (
  comment_id varchar(36) PRIMARY KEY,
  entity_type varchar(50) NOT NULL,
  entity_id varchar(36) NOT NULL,
  user_id varchar(36) NOT NULL,
  comment_text text NOT NULL,
  mentioned_users jsonb,
  parent_comment_id varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_comment_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_comment_entity ON entity_comments (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_comment_parent ON entity_comments (parent_comment_id);
CREATE OR REPLACE TRIGGER trg_entity_comments_updated_at
  BEFORE UPDATE ON entity_comments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Scheduled reports
CREATE TABLE IF NOT EXISTS scheduled_reports (
  report_id varchar(36) PRIMARY KEY,
  created_by varchar(36) NOT NULL,
  report_name varchar(255) NOT NULL,
  report_type varchar(50) NOT NULL,
  schedule_config jsonb NOT NULL,
  recipients jsonb NOT NULL,
  last_run_at timestamptz,
  next_run_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_report_user FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_report_active ON scheduled_reports (is_active);
CREATE INDEX IF NOT EXISTS idx_report_next_run ON scheduled_reports (next_run_at);

-- Voice transcription records
CREATE TABLE IF NOT EXISTS voice_transcriptions (
  transcription_id varchar(36) PRIMARY KEY,
  notification_id varchar(36),
  user_id varchar(36) NOT NULL,
  audio_file_path varchar(1024),
  transcription_text text,
  language varchar(10),
  confidence_score decimal(5,4),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_transcription_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id) ON DELETE SET NULL,
  CONSTRAINT fk_transcription_user FOREIGN KEY (user_id) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_transcription_notification ON voice_transcriptions (notification_id);

-- System settings and preferences
CREATE TABLE IF NOT EXISTS system_settings (
  setting_id varchar(36) PRIMARY KEY,
  setting_key varchar(100) NOT NULL UNIQUE,
  setting_value jsonb NOT NULL,
  description text,
  updated_by varchar(36),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_setting_user FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE OR REPLACE TRIGGER trg_system_settings_updated_at
  BEFORE UPDATE ON system_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- User preferences
CREATE TABLE IF NOT EXISTS user_preferences (
  preference_id varchar(36) PRIMARY KEY,
  user_id varchar(36) NOT NULL,
  preference_key varchar(100) NOT NULL,
  preference_value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_preference_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT uk_user_preference UNIQUE (user_id, preference_key)
);
CREATE OR REPLACE TRIGGER trg_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Structured causal chain COD architecture (WHO standards)
CREATE TABLE IF NOT EXISTS causal_chain_cod (
  chain_id varchar(36) PRIMARY KEY,
  notification_id varchar(36) NOT NULL,
  underlying_cause varchar(255),
  intermediate_cause varchar(255),
  immediate_cause varchar(255),
  contributory_conditions jsonb,
  created_by varchar(36) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_causal_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id) ON DELETE CASCADE,
  CONSTRAINT fk_causal_user FOREIGN KEY (created_by) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_causal_notification ON causal_chain_cod (notification_id);
CREATE OR REPLACE TRIGGER trg_causal_chain_cod_updated_at
  BEFORE UPDATE ON causal_chain_cod FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Standardized verbal autopsy (WHO/InterVA-5 standards)
CREATE TABLE IF NOT EXISTS verbal_autopsies (
  va_id varchar(36) PRIMARY KEY,
  notification_id varchar(36) NOT NULL,
  interviewer_name varchar(255),
  interview_date timestamptz,
  va_data jsonb NOT NULL,
  who_likely_cause varchar(255),
  confidence_score decimal(5,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_va_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_va_notification ON verbal_autopsies (notification_id);

-- Multi-expert DeCoDe panel review
CREATE TABLE IF NOT EXISTS decode_panels (
  panel_id varchar(36) PRIMARY KEY,
  notification_id varchar(36) NOT NULL,
  panel_lead varchar(36) NOT NULL,
  panel_members jsonb NOT NULL,
  consensus_cause varchar(255),
  consensus_date timestamptz,
  status varchar(50) DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_decode_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id) ON DELETE CASCADE,
  CONSTRAINT fk_decode_lead FOREIGN KEY (panel_lead) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_decode_notification ON decode_panels (notification_id);

-- Image annotations and diagnostic marks
CREATE TABLE IF NOT EXISTS image_annotations (
  annotation_id varchar(36) PRIMARY KEY,
  image_id varchar(36) NOT NULL,
  user_id varchar(36) NOT NULL,
  annotation_type varchar(50) NOT NULL,
  coordinates jsonb NOT NULL,
  text_note text,
  voice_note_path varchar(512),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_annotation_image FOREIGN KEY (image_id) REFERENCES tele_pathology_images(image_id) ON DELETE CASCADE,
  CONSTRAINT fk_annotation_user FOREIGN KEY (user_id) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_annotation_image ON image_annotations (image_id);

-- Diagnostic peer review requests
CREATE TABLE IF NOT EXISTS peer_reviews (
  review_id varchar(36) PRIMARY KEY,
  image_id varchar(36) NOT NULL,
  requester_id varchar(36) NOT NULL,
  reviewer_id varchar(36),
  review_status varchar(50) DEFAULT 'pending',
  review_notes text,
  recommendation varchar(255),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT fk_review_image FOREIGN KEY (image_id) REFERENCES tele_pathology_images(image_id) ON DELETE CASCADE,
  CONSTRAINT fk_review_requester FOREIGN KEY (requester_id) REFERENCES users(user_id),
  CONSTRAINT fk_review_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_review_image ON peer_reviews (image_id);
CREATE INDEX IF NOT EXISTS idx_review_reviewer ON peer_reviews (reviewer_id);

-- LIS chain-of-custody tracking
CREATE TABLE IF NOT EXISTS specimen_tracking (
  tracking_id varchar(36) PRIMARY KEY,
  specimen_qr varchar(255) NOT NULL UNIQUE,
  notification_id varchar(36) NOT NULL,
  specimen_type varchar(100) NOT NULL,
  collected_by varchar(36) NOT NULL,
  collection_location varchar(255),
  collection_date timestamptz NOT NULL,
  current_location varchar(255),
  current_holder varchar(36),
  status varchar(50) DEFAULT 'in_transit',
  tracking_log jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_specimen_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id) ON DELETE CASCADE,
  CONSTRAINT fk_specimen_collector FOREIGN KEY (collected_by) REFERENCES users(user_id),
  CONSTRAINT fk_specimen_holder FOREIGN KEY (current_holder) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_specimen_qr ON specimen_tracking (specimen_qr);
CREATE INDEX IF NOT EXISTS idx_specimen_status ON specimen_tracking (status);
CREATE OR REPLACE TRIGGER trg_specimen_tracking_updated_at
  BEFORE UPDATE ON specimen_tracking FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- CRVS integration bridge
CREATE TABLE IF NOT EXISTS crvs_bridge (
  bridge_id varchar(36) PRIMARY KEY,
  notification_id varchar(36) NOT NULL,
  crvs_reference_number varchar(255),
  integration_status varchar(50) DEFAULT 'pending',
  sent_at timestamptz,
  acknowledged_at timestamptz,
  error_message text,
  retry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_crvs_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_crvs_status ON crvs_bridge (integration_status);
CREATE INDEX IF NOT EXISTS idx_crvs_reference ON crvs_bridge (crvs_reference_number);
CREATE OR REPLACE TRIGGER trg_crvs_bridge_updated_at
  BEFORE UPDATE ON crvs_bridge FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- USSD/WhatsApp community surveillance
CREATE TABLE IF NOT EXISTS community_reports (
  report_id varchar(36) PRIMARY KEY,
  reporter_phone varchar(50) NOT NULL,
  report_type varchar(50) NOT NULL,
  location_name varchar(255),
  district varchar(100),
  province varchar(100),
  report_message text,
  estimated_cases integer,
  severity varchar(50),
  reported_at timestamptz NOT NULL DEFAULT now(),
  verified boolean DEFAULT false,
  verified_by varchar(36),
  verification_notes text,
  CONSTRAINT fk_community_verifier FOREIGN KEY (verified_by) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_community_district ON community_reports (district);
CREATE INDEX IF NOT EXISTS idx_community_status ON community_reports (verified);

-- Environmental & climate data for forecasting
CREATE TABLE IF NOT EXISTS environmental_data (
  env_id varchar(36) PRIMARY KEY,
  district varchar(100) NOT NULL,
  data_type varchar(50) NOT NULL,
  measurement_value decimal(10,2),
  unit varchar(50),
  recorded_at timestamptz NOT NULL,
  source varchar(100)
);
CREATE INDEX IF NOT EXISTS idx_env_district_type ON environmental_data (district, data_type);
CREATE INDEX IF NOT EXISTS idx_env_recorded ON environmental_data (recorded_at);

-- Patient anonymization logs
CREATE TABLE IF NOT EXISTS anonymization_logs (
  log_id varchar(36) PRIMARY KEY,
  user_id varchar(36) NOT NULL,
  entity_type varchar(50) NOT NULL,
  entity_id varchar(36) NOT NULL,
  anonymized_fields jsonb NOT NULL,
  access_purpose varchar(100),
  requested_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_anon_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_anon_user ON anonymization_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_anon_entity ON anonymization_logs (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Alter Existing Tables for Enhanced Features
-- ---------------------------------------------------------------------------

-- Update users table to support new roles and additional fields
ALTER TABLE users ALTER COLUMN role TYPE varchar(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone varchar(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS department varchar(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_updated_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS language varchar(10) DEFAULT 'en';
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone varchar(50) DEFAULT 'Africa/Harare';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url varchar(512);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz;

-- Update death_notifications for international standards
ALTER TABLE death_notifications ADD COLUMN IF NOT EXISTS icd_version varchar(10) DEFAULT 'ICD-10';
ALTER TABLE death_notifications ADD COLUMN IF NOT EXISTS who_notifiable boolean DEFAULT false;
ALTER TABLE death_notifications ADD COLUMN IF NOT EXISTS verbal_autopsy_data jsonb;
ALTER TABLE death_notifications ADD COLUMN IF NOT EXISTS gps_coordinates jsonb;
ALTER TABLE death_notifications ADD COLUMN IF NOT EXISTS underlying_cause varchar(255);
ALTER TABLE death_notifications ADD COLUMN IF NOT EXISTS intermediate_cause varchar(255);
ALTER TABLE death_notifications ADD COLUMN IF NOT EXISTS immediate_cause varchar(255);
ALTER TABLE death_notifications ADD COLUMN IF NOT EXISTS contributory_conditions jsonb;
ALTER TABLE death_notifications ADD COLUMN IF NOT EXISTS is_cross_border boolean DEFAULT false;
ALTER TABLE death_notifications ADD COLUMN IF NOT EXISTS source_country varchar(100) DEFAULT 'Zimbabwe';
ALTER TABLE death_notifications ADD COLUMN IF NOT EXISTS travel_history text;

-- Enhanced audit with IP tracking (extends existing audit_log)
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS session_id varchar(36);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS device_fingerprint varchar(100);
CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log (session_id);
CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_log (user_id, created_at);

-- ---------------------------------------------------------------------------
-- Data Migration: Update existing user roles from mohcc_admin to public_health_analyst
-- ---------------------------------------------------------------------------

UPDATE users SET role = 'public_health_analyst' WHERE role = 'mohcc_admin';
