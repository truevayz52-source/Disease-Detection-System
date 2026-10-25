-- DDS full schema setup - concatenated supabase/migrations 0001-0010
-- for one-shot paste into the Supabase SQL editor.

-- ===== migrations/20251018000001_schema.sql =====
-- Disease Detection System (DDS) relational schema (PostgreSQL 15+ / Supabase)
-- Ported from db/001-schema.sql (MySQL 8 / MariaDB 10.4).
-- Chapter 4, section 4.5 - Database Design.
-- Auth: stateful JWT (sessions table) + Argon2 password hashes per Chapter 4.7/5.3.

-- updated_at maintenance: MySQL's ON UPDATE CURRENT_TIMESTAMP has no Postgres
-- equivalent; one shared BEFORE UPDATE trigger covers every table.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Reference + auth tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS facilities (
  facility_id varchar(36) PRIMARY KEY,
  facility_name varchar(255) NOT NULL,
  province varchar(100) NOT NULL,
  district varchar(100) NOT NULL,
  latitude decimal(10,6) NOT NULL,
  longitude decimal(10,6) NOT NULL,
  facility_type varchar(60) NOT NULL DEFAULT 'district_hospital',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  user_id varchar(36) PRIMARY KEY,
  full_name varchar(255) NOT NULL,
  email varchar(255) NOT NULL UNIQUE,
  password_hash varchar(255) NOT NULL,
  role varchar(40) NOT NULL DEFAULT 'medical_officer',
  facility_id varchar(36),
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_user_facility FOREIGN KEY (facility_id) REFERENCES facilities(facility_id) ON DELETE SET NULL
);
CREATE OR REPLACE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Stateful JWT sessions: server can revoke a token before it expires (Ch 4.7).
CREATE TABLE IF NOT EXISTS sessions (
  session_id varchar(36) PRIMARY KEY,
  user_id varchar(36) NOT NULL,
  token_hash varchar(128) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  ip_address varchar(64),
  user_agent varchar(512),
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_user ON sessions (user_id);

-- ---------------------------------------------------------------------------
-- Domain tables (Chapter 4.5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS icd_codes (
  icd_code varchar(12) PRIMARY KEY,
  icd_version varchar(6) NOT NULL DEFAULT 'ICD-10',
  description varchar(255) NOT NULL,
  disease_category varchar(100) NOT NULL,
  is_notifiable boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS patients (
  patient_id varchar(36) PRIMARY KEY,
  national_id varchar(60),
  full_name varchar(255) NOT NULL,
  age integer,
  gender varchar(20) NOT NULL,
  residential_address varchar(512),
  latitude decimal(10,6),
  longitude decimal(10,6),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_patient_national_id ON patients (national_id);
CREATE INDEX IF NOT EXISTS idx_patient_name ON patients (full_name);

CREATE TABLE IF NOT EXISTS death_notifications (
  notification_id varchar(36) PRIMARY KEY,
  patient_id varchar(36) NOT NULL,
  facility_id varchar(36) NOT NULL,
  date_of_death timestamptz NOT NULL,
  preliminary_icd_code varchar(12) NOT NULL,
  clinical_summary text,
  reported_by varchar(36) NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'pending_review',
  is_maternal_perinatal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_dn_patient FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
  CONSTRAINT fk_dn_facility FOREIGN KEY (facility_id) REFERENCES facilities(facility_id),
  CONSTRAINT fk_dn_icd FOREIGN KEY (preliminary_icd_code) REFERENCES icd_codes(icd_code),
  CONSTRAINT fk_dn_reporter FOREIGN KEY (reported_by) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_dn_facility_date ON death_notifications (facility_id, date_of_death);
CREATE INDEX IF NOT EXISTS idx_dn_icd_date ON death_notifications (preliminary_icd_code, date_of_death);
CREATE INDEX IF NOT EXISTS idx_dn_status ON death_notifications (status);
CREATE OR REPLACE TRIGGER trg_death_notifications_updated_at
  BEFORE UPDATE ON death_notifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS tele_pathology_images (
  image_id varchar(36) PRIMARY KEY,
  notification_id varchar(36) NOT NULL,
  file_path varchar(1024) NOT NULL,
  mime_type varchar(80),
  resolution varchar(40),
  file_hash varchar(128) NOT NULL,
  original_size_bytes bigint,
  compressed_size_bytes bigint,
  compressed boolean NOT NULL DEFAULT false,
  uploaded_by varchar(36) NOT NULL,
  uploaded_timestamp timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_img_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id) ON DELETE CASCADE,
  CONSTRAINT fk_img_uploader FOREIGN KEY (uploaded_by) REFERENCES users(user_id)
);
CREATE INDEX IF NOT EXISTS idx_img_notification ON tele_pathology_images (notification_id);

CREATE TABLE IF NOT EXISTS autopsy_reports (
  autopsy_id varchar(36) PRIMARY KEY,
  notification_id varchar(36) NOT NULL UNIQUE,
  pathologist_id varchar(36) NOT NULL,
  internal_observations text,
  toxicology_results text,
  legal_threshold_flag boolean NOT NULL DEFAULT false,
  final_icd_code varchar(12),
  final_cause_of_death varchar(512),
  digital_signature varchar(255),
  audit_hash varchar(128) NOT NULL,
  status varchar(40) NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  CONSTRAINT fk_autopsy_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id) ON DELETE CASCADE,
  CONSTRAINT fk_autopsy_pathologist FOREIGN KEY (pathologist_id) REFERENCES users(user_id),
  CONSTRAINT fk_autopsy_icd FOREIGN KEY (final_icd_code) REFERENCES icd_codes(icd_code)
);

CREATE TABLE IF NOT EXISTS outbreak_alerts (
  alert_id varchar(36) PRIMARY KEY,
  disease_category varchar(100) NOT NULL,
  district varchar(100) NOT NULL,
  cluster_data jsonb,
  case_count integer NOT NULL DEFAULT 0,
  risk_score decimal(5,2) NOT NULL DEFAULT 0,
  alert_type varchar(40) NOT NULL DEFAULT 'outbreak',
  triggered_date timestamptz NOT NULL DEFAULT now(),
  status varchar(40) NOT NULL DEFAULT 'active',
  dispatched_channels varchar(255),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_alert_status ON outbreak_alerts (status);
CREATE INDEX IF NOT EXISTS idx_alert_district ON outbreak_alerts (district);

-- Immutable, tamper-evident audit chain (Ch 4.7): each row's record_hash covers
-- the row payload plus the previous row's hash, so altering history is detectable.
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id varchar(36) PRIMARY KEY,
  user_id varchar(36),
  action varchar(100) NOT NULL,
  entity_type varchar(60) NOT NULL,
  entity_id varchar(36),
  ip_address varchar(64),
  details text,
  record_hash varchar(128) NOT NULL,
  previous_hash varchar(128),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at);

-- ===== migrations/20251018000002_schema_enhancements.sql =====
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

-- GPS tracking for field workers
CREATE TABLE IF NOT EXISTS gps_tracking (
  tracking_id varchar(36) PRIMARY KEY,
  user_id varchar(36) NOT NULL,
  latitude decimal(10,6) NOT NULL,
  longitude decimal(10,6) NOT NULL,
  accuracy decimal(10,2),
  altitude decimal(10,2),
  tracking_timestamp timestamptz NOT NULL DEFAULT now(),
  activity_type varchar(50),
  CONSTRAINT fk_gps_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_gps_user_time ON gps_tracking (user_id, tracking_timestamp);
CREATE INDEX IF NOT EXISTS idx_gps_location ON gps_tracking (latitude, longitude);

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

-- ===== migrations/20251018000003_runtime_enhancements.sql =====
-- PostgreSQL port of db/003-runtime-enhancements.sql

ALTER TABLE two_factor_auth ADD COLUMN IF NOT EXISTS last_counter bigint NOT NULL DEFAULT -1;

-- MySQL AUTO_INCREMENT -> identity column; UNIQUE via index (idempotent).
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS chain_sequence bigint GENERATED BY DEFAULT AS IDENTITY;
CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_chain_sequence ON audit_log (chain_sequence);

CREATE TABLE IF NOT EXISTS email_aliases (
  email varchar(255) PRIMARY KEY,
  user_id varchar(36) NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT fk_email_alias_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notification_submissions (
  submission_id varchar(100) PRIMARY KEY,
  user_id varchar(36) NOT NULL,
  notification_id varchar(36),
  payload_hash varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===== migrations/20251018000004_report_runs.sql =====
-- PostgreSQL port of db/004-report-runs.sql

CREATE TABLE IF NOT EXISTS report_runs (
  run_id varchar(36) PRIMARY KEY,
  report_id varchar(36) NOT NULL,
  owner_id varchar(36) NOT NULL,
  report_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_report_run FOREIGN KEY (report_id) REFERENCES scheduled_reports(report_id) ON DELETE CASCADE,
  CONSTRAINT fk_run_owner FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_report_owner ON report_runs (owner_id, created_at);

-- ===== migrations/20251018000005_biim_aligned.sql =====
-- PostgreSQL port of db/005-biim-aligned.sql
-- DDS schema extension - BIIM-aligned capabilities (behavioural intelligence &
-- infodemic management). External-integration tables intentionally excluded.

-- ---------------------------------------------------------------------------
-- Health signals: community death reporting / mortality surveillance signal
-- detection. Transitions are appended to signal_workflow_events and mirrored
-- into audit_log.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS health_signals (
  signal_id varchar(36) PRIMARY KEY,
  external_id varchar(128) UNIQUE,          -- deduplication key for offline/field ingestion
  signal_type varchar(40) NOT NULL DEFAULT 'unreported_death', -- unreported_death|suspicious_death|maternal_perinatal|death_cluster|community_alert
  title varchar(255) NOT NULL,
  description text,
  source_channel varchar(40) NOT NULL DEFAULT 'community', -- community|vhw|facility|police|media|offline
  district varchar(100),
  province varchar(100),
  facility_id varchar(36),
  severity varchar(20) NOT NULL DEFAULT 'medium', -- low|medium|high|critical
  status varchar(20) NOT NULL DEFAULT 'new',     -- new|triaged|investigating|resolved|dismissed
  workflow_stage varchar(30) NOT NULL DEFAULT 'captured', -- captured|verified|escalated|closed
  evidence text,
  action_taken text,
  outcome text,
  linked_notification_id varchar(36),          -- death notification this signal was linked to, if any
  linked_alert_id varchar(36),                 -- outbreak alert this signal was linked to, if any
  reported_by varchar(36),
  assigned_to varchar(36),
  reported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_signal_facility FOREIGN KEY (facility_id) REFERENCES facilities(facility_id) ON DELETE SET NULL,
  CONSTRAINT fk_signal_reporter FOREIGN KEY (reported_by) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_signal_assignee FOREIGN KEY (assigned_to) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_signal_notification FOREIGN KEY (linked_notification_id) REFERENCES death_notifications(notification_id) ON DELETE SET NULL,
  CONSTRAINT fk_signal_alert FOREIGN KEY (linked_alert_id) REFERENCES outbreak_alerts(alert_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_signal_status ON health_signals (status);
CREATE INDEX IF NOT EXISTS idx_signal_district ON health_signals (district);
CREATE INDEX IF NOT EXISTS idx_signal_type ON health_signals (signal_type);
CREATE OR REPLACE TRIGGER trg_health_signals_updated_at
  BEFORE UPDATE ON health_signals FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS signal_workflow_events (
  event_id varchar(36) PRIMARY KEY,
  signal_id varchar(36) NOT NULL,
  from_stage varchar(30),
  to_stage varchar(30) NOT NULL,
  from_status varchar(20),
  to_status varchar(20),
  actor_id varchar(36),
  actor_name varchar(255),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_swe_signal FOREIGN KEY (signal_id) REFERENCES health_signals(signal_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_swe_signal ON signal_workflow_events (signal_id);

-- Community feedback on mortality surveillance services.
CREATE TABLE IF NOT EXISTS feedback_items (
  feedback_id varchar(36) PRIMARY KEY,
  channel varchar(40) NOT NULL DEFAULT 'community',
  subject varchar(255) NOT NULL,
  message text,
  district varchar(100),
  province varchar(100),
  sentiment varchar(20),                       -- positive|neutral|negative
  status varchar(20) NOT NULL DEFAULT 'new',   -- new|reviewed|actioned
  linked_signal_id varchar(36),
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_feedback_signal FOREIGN KEY (linked_signal_id) REFERENCES health_signals(signal_id) ON DELETE SET NULL,
  CONSTRAINT fk_feedback_user FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback_items (status);

-- Media monitoring - mentions relevant to mortality surveillance / infodemic.
CREATE TABLE IF NOT EXISTS media_mentions (
  mention_id varchar(36) PRIMARY KEY,
  source_name varchar(255) NOT NULL,
  source_type varchar(40) NOT NULL DEFAULT 'news', -- news|radio|social|print|other
  headline varchar(500) NOT NULL,
  url varchar(1000),
  summary text,
  sentiment varchar(20),
  topics varchar(500),
  district varchar(100),
  province varchar(100),
  linked_signal_id varchar(36),
  captured_by varchar(36),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_media_signal FOREIGN KEY (linked_signal_id) REFERENCES health_signals(signal_id) ON DELETE SET NULL,
  CONSTRAINT fk_media_user FOREIGN KEY (captured_by) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_media_district ON media_mentions (district);

-- Case investigations opened from signals or alerts.
CREATE TABLE IF NOT EXISTS case_investigations (
  investigation_id varchar(36) PRIMARY KEY,
  linked_signal_id varchar(36),
  linked_alert_id varchar(36),
  linked_notification_id varchar(36),
  title varchar(255) NOT NULL,
  findings text,
  status varchar(20) NOT NULL DEFAULT 'open',  -- open|ongoing|concluded
  lead_investigator varchar(36),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT fk_inv_signal FOREIGN KEY (linked_signal_id) REFERENCES health_signals(signal_id) ON DELETE SET NULL,
  CONSTRAINT fk_inv_alert FOREIGN KEY (linked_alert_id) REFERENCES outbreak_alerts(alert_id) ON DELETE SET NULL,
  CONSTRAINT fk_inv_notification FOREIGN KEY (linked_notification_id) REFERENCES death_notifications(notification_id) ON DELETE SET NULL,
  CONSTRAINT fk_inv_lead FOREIGN KEY (lead_investigator) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_status ON case_investigations (status);

-- Field / health-promotion activities.
CREATE TABLE IF NOT EXISTS health_activities (
  activity_id varchar(36) PRIMARY KEY,
  title varchar(255) NOT NULL,
  activity_type varchar(50) NOT NULL DEFAULT 'outreach',
  description text,
  district varchar(100),
  province varchar(100),
  facility_id varchar(36),
  scheduled_date date,
  status varchar(20) NOT NULL DEFAULT 'planned', -- planned|in_progress|completed|cancelled
  participants_reached integer,
  coordinator_id varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_act_facility FOREIGN KEY (facility_id) REFERENCES facilities(facility_id) ON DELETE SET NULL,
  CONSTRAINT fk_act_coordinator FOREIGN KEY (coordinator_id) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_act_district ON health_activities (district);

-- Health-promotion campaigns.
CREATE TABLE IF NOT EXISTS campaigns (
  campaign_id varchar(36) PRIMARY KEY,
  name varchar(255) NOT NULL,
  objective text,
  target_district varchar(100),
  target_province varchar(100),
  start_date date,
  end_date date,
  status varchar(20) NOT NULL DEFAULT 'draft',   -- draft|active|paused|completed
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_campaign_creator FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_campaign_status ON campaigns (status);

-- IEC (information, education & communication) materials registry.
CREATE TABLE IF NOT EXISTS iec_materials (
  material_id varchar(36) PRIMARY KEY,
  title varchar(255) NOT NULL,
  material_type varchar(50) NOT NULL DEFAULT 'poster', -- poster|leaflet|radio_spot|video|other
  language varchar(40) NOT NULL DEFAULT 'en',        -- en|sn|nd
  topic varchar(255),
  file_path varchar(500),
  approved boolean NOT NULL DEFAULT false,
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_iec_creator FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Training sessions (mortality surveillance staff, community workers).
CREATE TABLE IF NOT EXISTS trainings (
  training_id varchar(36) PRIMARY KEY,
  title varchar(255) NOT NULL,
  audience varchar(120),
  district varchar(100),
  province varchar(100),
  training_date date,
  facilitator_id varchar(36),
  participants_count integer,
  status varchar(20) NOT NULL DEFAULT 'scheduled', -- scheduled|completed|cancelled
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_training_facilitator FOREIGN KEY (facilitator_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Calendar events for surveillance/response planning.
CREATE TABLE IF NOT EXISTS calendar_events (
  event_id varchar(36) PRIMARY KEY,
  title varchar(255) NOT NULL,
  description text,
  event_type varchar(50) NOT NULL DEFAULT 'general',
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  district varchar(100),
  province varchar(100),
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_cal_creator FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_cal_start ON calendar_events (start_at);

-- Document repository metadata (files themselves live under server/uploads).
CREATE TABLE IF NOT EXISTS documents (
  document_id varchar(36) PRIMARY KEY,
  title varchar(255) NOT NULL,
  category varchar(60) NOT NULL DEFAULT 'general',
  file_path varchar(500),
  mime_type varchar(120),
  uploaded_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_doc_uploader FOREIGN KEY (uploaded_by) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_category ON documents (category);

-- Communication dispatch log - internal notifications to personnel.
CREATE TABLE IF NOT EXISTS communications_log (
  comm_id varchar(36) PRIMARY KEY,
  channel varchar(40) NOT NULL DEFAULT 'in_app',  -- in_app|email
  subject varchar(255) NOT NULL,
  body text,
  audience varchar(255),
  sent_by varchar(36),
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_comm_sender FOREIGN KEY (sent_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- ===== migrations/20251018000006_biim_port.sql =====
-- PostgreSQL port of db/006-biim-port.sql
-- BIIMZim port (hierarchical scoping, SLA, classifier output, playbooks,
-- evidence attachments, login/password history).

-- ---------------------------------------------------------------------------
-- Geographic reference (Zimbabwe): 10 provinces - "National" deliberately
-- excluded per requirement; it is a scope level, not a province.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provinces (
  province_id varchar(36) PRIMARY KEY,
  province_name varchar(100) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS districts (
  district_id varchar(36) PRIMARY KEY,
  province varchar(100) NOT NULL,
  district varchar(100) NOT NULL,
  CONSTRAINT uq_province_district UNIQUE (province, district)
);

-- Hierarchical scoping attributes on users (BIIM scope_clause equivalent).
ALTER TABLE users ADD COLUMN IF NOT EXISTS province varchar(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS district varchar(100);

-- Signal SLA + rules-classifier output columns.
ALTER TABLE health_signals ADD COLUMN IF NOT EXISTS sla_due_at timestamptz;
ALTER TABLE health_signals ADD COLUMN IF NOT EXISTS sla_breached boolean NOT NULL DEFAULT false;
ALTER TABLE health_signals ADD COLUMN IF NOT EXISTS risk_score integer;
ALTER TABLE health_signals ADD COLUMN IF NOT EXISTS classified_topics varchar(500);
ALTER TABLE health_signals ADD COLUMN IF NOT EXISTS sentiment varchar(20);
ALTER TABLE health_signals ADD COLUMN IF NOT EXISTS classified_drivers varchar(500);

ALTER TABLE community_reports ADD COLUMN IF NOT EXISTS risk_score integer;
ALTER TABLE community_reports ADD COLUMN IF NOT EXISTS classified_topics varchar(500);
ALTER TABLE community_reports ADD COLUMN IF NOT EXISTS sentiment varchar(20);

-- BIIM sourceId for facility-merge dedup.
ALTER TABLE facilities ADD COLUMN IF NOT EXISTS source_id varchar(40);
CREATE INDEX IF NOT EXISTS idx_facility_source_id ON facilities (source_id);

-- ---------------------------------------------------------------------------
-- Evidence attachments for signals / grievances / notifications.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidence_files (
  evidence_id varchar(36) PRIMARY KEY,
  entity_type varchar(30) NOT NULL,              -- signal|notification
  entity_id varchar(36) NOT NULL,
  file_path varchar(500) NOT NULL,
  original_name varchar(255) NOT NULL,
  mime_type varchar(120),
  size_bytes integer,
  uploaded_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_evidence_uploader FOREIGN KEY (uploaded_by) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_entity ON evidence_files (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Response playbooks - predefined action templates attachable to signals.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS response_playbooks (
  playbook_id varchar(36) PRIMARY KEY,
  name varchar(255) NOT NULL,
  description text,
  signal_type varchar(40),                        -- target signal type (NULL = any)
  disease_category varchar(100),
  steps jsonb NOT NULL,                           -- ordered list of recommended actions
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_playbook_creator FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS signal_playbook_links (
  signal_id varchar(36) NOT NULL,
  playbook_id varchar(36) NOT NULL,
  attached_by varchar(36),
  attached_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (signal_id, playbook_id),
  CONSTRAINT fk_spl_signal FOREIGN KEY (signal_id) REFERENCES health_signals(signal_id) ON DELETE CASCADE,
  CONSTRAINT fk_spl_playbook FOREIGN KEY (playbook_id) REFERENCES response_playbooks(playbook_id) ON DELETE CASCADE,
  CONSTRAINT fk_spl_user FOREIGN KEY (attached_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------------
-- Auth forensics: every login attempt + previous password hashes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_history (
  history_id varchar(36) PRIMARY KEY,
  user_id varchar(36),
  email varchar(255) NOT NULL,
  success boolean NOT NULL,
  failure_reason varchar(120),
  ip_address varchar(64),
  user_agent varchar(512),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_loginhist_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_loginhist_email ON login_history (email);
CREATE INDEX IF NOT EXISTS idx_loginhist_time ON login_history (created_at);

CREATE TABLE IF NOT EXISTS password_history (
  history_id varchar(36) PRIMARY KEY,
  user_id varchar(36) NOT NULL,
  password_hash varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_pwhist_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pwhist_user ON password_history (user_id);

-- ===== migrations/20251018000007_case_workflow.sql =====
-- PostgreSQL port of db/007-case-workflow.sql
-- Adds rejected/assigned/SLA tracking on death_notifications, medical
-- officer MCCD certification table, autopsy signature HMACs, and a link
-- from verified community reports to health_signals.

-- ---------------------------------------------------------------------------
-- death_notifications workflow fields
-- ---------------------------------------------------------------------------
ALTER TABLE death_notifications ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE death_notifications ADD COLUMN IF NOT EXISTS rejected_by varchar(36);
ALTER TABLE death_notifications ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE death_notifications ADD COLUMN IF NOT EXISTS assigned_to varchar(36);
ALTER TABLE death_notifications ADD COLUMN IF NOT EXISTS review_due_at timestamptz;

-- ---------------------------------------------------------------------------
-- autopsy report signature integrity
-- ---------------------------------------------------------------------------
ALTER TABLE autopsy_reports ADD COLUMN IF NOT EXISTS signature_hmac varchar(128);

-- ---------------------------------------------------------------------------
-- community report -> health_signal linkage
-- ---------------------------------------------------------------------------
ALTER TABLE community_reports ADD COLUMN IF NOT EXISTS linked_signal_id varchar(36);

-- ---------------------------------------------------------------------------
-- Medical officer MCCD certification (non-medico-legal deaths).
-- Mirrors autopsy_reports for the certificate path but is distinct:
-- only medical officers certify natural-cause deaths without autopsy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS medical_certifications (
  certification_id varchar(36) PRIMARY KEY,
  notification_id varchar(36) NOT NULL UNIQUE,
  certified_by varchar(36) NOT NULL,
  final_icd_code varchar(12) NOT NULL,
  final_cause_of_death varchar(512) NOT NULL,
  manner_of_death varchar(40) NOT NULL DEFAULT 'natural',
  signer_name varchar(255) NOT NULL,
  signature_hmac varchar(128) NOT NULL,
  audit_hash varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_cert_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id) ON DELETE CASCADE,
  CONSTRAINT fk_cert_user FOREIGN KEY (certified_by) REFERENCES users(user_id),
  CONSTRAINT fk_cert_icd FOREIGN KEY (final_icd_code) REFERENCES icd_codes(icd_code)
);

-- ===== migrations/20251018000008_mpdsr_review_stages.sql =====
-- PostgreSQL port of db/008-mpdsr-review-stages.sql
-- MPDSR review pipeline: notified -> in_review -> actions_assigned -> completed
-- with cause classification, preventability, contributing factors and a
-- tracked corrective-action list (the WHO "closed loop").

-- ---------------------------------------------------------------------------
-- mpdsr_workflows review fields
-- ---------------------------------------------------------------------------
ALTER TABLE mpdsr_workflows ADD COLUMN IF NOT EXISTS review_scheduled_at timestamptz;
ALTER TABLE mpdsr_workflows ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE mpdsr_workflows ADD COLUMN IF NOT EXISTS review_panel varchar(500);
ALTER TABLE mpdsr_workflows ADD COLUMN IF NOT EXISTS cause_classification varchar(40); -- direct_obstetric|indirect_obstetric|coincidental|undetermined
ALTER TABLE mpdsr_workflows ADD COLUMN IF NOT EXISTS preventability varchar(30);        -- preventable|potentially_preventable|not_preventable|undetermined
ALTER TABLE mpdsr_workflows ADD COLUMN IF NOT EXISTS contributing_factors text;         -- JSON array of contributing factor strings
ALTER TABLE mpdsr_workflows ADD COLUMN IF NOT EXISTS review_due_at timestamptz;         -- facility-level review target - notification + 7 days
ALTER TABLE mpdsr_workflows ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- response_status becomes the canonical review stage.
ALTER TABLE mpdsr_workflows ALTER COLUMN response_status TYPE varchar(30);
ALTER TABLE mpdsr_workflows ALTER COLUMN response_status SET NOT NULL;
ALTER TABLE mpdsr_workflows ALTER COLUMN response_status SET DEFAULT 'notified'; -- notified|in_review|actions_assigned|completed

UPDATE mpdsr_workflows SET response_status = 'notified'  WHERE response_status = 'pending';
UPDATE mpdsr_workflows SET response_status = 'in_review' WHERE response_status IN ('investigating', 'in_progress', 'investigation');
UPDATE mpdsr_workflows SET response_status = 'completed' WHERE response_status = 'closed';
UPDATE mpdsr_workflows SET review_due_at = COALESCE(notification_timestamp, created_at) + INTERVAL '7 days'
  WHERE review_due_at IS NULL;
UPDATE mpdsr_workflows SET completed_at = updated_at
  WHERE response_status = 'completed' AND completed_at IS NULL;

-- ---------------------------------------------------------------------------
-- mpdsr_actions - corrective actions tracked to completion (closed loop).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mpdsr_actions (
  action_id varchar(36) PRIMARY KEY,
  workflow_id varchar(36) NOT NULL,
  action_text varchar(500) NOT NULL,
  responsible_party varchar(255),
  due_date date,
  status varchar(20) NOT NULL DEFAULT 'open',   -- open|done|cancelled
  created_by varchar(36),
  completed_by varchar(36),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_mpdsr_action_workflow FOREIGN KEY (workflow_id) REFERENCES mpdsr_workflows(workflow_id) ON DELETE CASCADE,
  CONSTRAINT fk_mpdsr_action_creator FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_mpdsr_action_completer FOREIGN KEY (completed_by) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_mpdsr_action_workflow ON mpdsr_actions (workflow_id);
CREATE INDEX IF NOT EXISTS idx_mpdsr_action_status ON mpdsr_actions (status);

-- ===== migrations/20251018000009_offline_lww.sql =====
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

-- ===== migrations/20251018000010_supabase_auth_link.sql =====
-- Phase 2 hybrid auth: link application users to Supabase Auth identities.
-- Column + index only - no FK to auth.users(id), so this migration also
-- applies on a plain local Postgres that has no auth schema.
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_user_id uuid;
CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON users (auth_user_id);

