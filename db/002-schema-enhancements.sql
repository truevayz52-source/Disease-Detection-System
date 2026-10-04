-- Disease Detection System (DDS) Schema Enhancements
-- Comprehensive modernization with 6 roles, advanced features, and modern technology

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- New Tables for Enhanced Features
-- ---------------------------------------------------------------------------

-- Offline sync queue for IndexedDB persistence
CREATE TABLE IF NOT EXISTS offline_sync_queue (
  queue_id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_data JSON NOT NULL,
  sync_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  sync_attempts INT NOT NULL DEFAULT 0,
  last_sync_attempt DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  synced_at DATETIME,
  CONSTRAINT fk_queue_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_queue_user_status (user_id, sync_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- MPDSR workflow tracking
CREATE TABLE IF NOT EXISTS mpdsr_workflows (
  workflow_id VARCHAR(36) PRIMARY KEY,
  notification_id VARCHAR(36) NOT NULL,
  initiated_by VARCHAR(36) NOT NULL,
  department_notified VARCHAR(255),
  notification_timestamp DATETIME,
  response_status VARCHAR(50) DEFAULT 'pending',
  investigation_notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mpdsr_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id) ON DELETE CASCADE,
  CONSTRAINT fk_mpdsr_user FOREIGN KEY (initiated_by) REFERENCES users(user_id),
  INDEX idx_mpdsr_notification (notification_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- AI pathology pre-screening results
CREATE TABLE IF NOT EXISTS ai_pathology_analysis (
  analysis_id VARCHAR(36) PRIMARY KEY,
  image_id VARCHAR(36) NOT NULL,
  notification_id VARCHAR(36) NOT NULL,
  model_version VARCHAR(50) NOT NULL,
  anomaly_score DECIMAL(5,4) NOT NULL,
  anomaly_regions JSON,
  confidence_score DECIMAL(5,4),
  analysis_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by VARCHAR(36),
  reviewed_at DATETIME,
  CONSTRAINT fk_ai_image FOREIGN KEY (image_id) REFERENCES tele_pathology_images(image_id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id),
  INDEX idx_ai_image (image_id),
  INDEX idx_ai_notification (notification_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Predictive resource allocation forecasts
CREATE TABLE IF NOT EXISTS resource_forecasts (
  forecast_id VARCHAR(36) PRIMARY KEY,
  district VARCHAR(100) NOT NULL,
  disease_category VARCHAR(100) NOT NULL,
  forecast_horizon_days INT NOT NULL,
  predicted_cases INT NOT NULL,
  recommended_supplies JSON,
  confidence_level DECIMAL(5,4),
  forecast_generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  forecast_target_date DATETIME NOT NULL,
  actual_cases INT,
  actual_outcome DATETIME,
  INDEX idx_forecast_district (district),
  INDEX idx_forecast_target (forecast_target_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Custom alert threshold configurations
CREATE TABLE IF NOT EXISTS alert_thresholds (
  threshold_id VARCHAR(36) PRIMARY KEY,
  configured_by VARCHAR(36) NOT NULL,
  district VARCHAR(100),
  disease_category VARCHAR(100),
  case_threshold INT NOT NULL,
  time_window_hours INT NOT NULL,
  spatial_radius_km DECIMAL(10,2),
  alert_priority VARCHAR(20) DEFAULT 'normal',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_threshold_user FOREIGN KEY (configured_by) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_threshold_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Cross-border disease tracking
CREATE TABLE IF NOT EXISTS cross_border_cases (
  cross_border_id VARCHAR(36) PRIMARY KEY,
  notification_id VARCHAR(36) NOT NULL,
  source_country VARCHAR(100) NOT NULL,
  border_crossing_point VARCHAR(255),
  travel_history TEXT,
  cluster_reference_id VARCHAR(36),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cross_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id),
  INDEX idx_cross_country (source_country)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used BOOLEAN NOT NULL DEFAULT false,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_reset_token (token_hash),
  INDEX idx_reset_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Real-time notifications
CREATE TABLE IF NOT EXISTS user_notifications (
  notification_id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  notification_type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  action_url VARCHAR(512),
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_notification_user_read (user_id, is_read),
  INDEX idx_notification_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Two-factor authentication
CREATE TABLE IF NOT EXISTS two_factor_auth (
  tfa_id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  secret_key VARCHAR(255) NOT NULL,
  backup_codes JSON,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tfa_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_tfa_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Blockchain audit trail (immutable records)
CREATE TABLE IF NOT EXISTS blockchain_audit (
  block_id VARCHAR(36) PRIMARY KEY,
  previous_hash VARCHAR(128) NOT NULL,
  block_hash VARCHAR(128) NOT NULL,
  audit_data JSON NOT NULL,
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  mined_by VARCHAR(36),
  INDEX idx_blockchain_hash (block_hash),
  INDEX idx_blockchain_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Comments and collaboration
CREATE TABLE IF NOT EXISTS entity_comments (
  comment_id VARCHAR(36) PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  comment_text TEXT NOT NULL,
  mentioned_users JSON,
  parent_comment_id VARCHAR(36),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_comment_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_comment_entity (entity_type, entity_id),
  INDEX idx_comment_parent (parent_comment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Scheduled reports
CREATE TABLE IF NOT EXISTS scheduled_reports (
  report_id VARCHAR(36) PRIMARY KEY,
  created_by VARCHAR(36) NOT NULL,
  report_name VARCHAR(255) NOT NULL,
  report_type VARCHAR(50) NOT NULL,
  schedule_config JSON NOT NULL,
  recipients JSON NOT NULL,
  last_run_at DATETIME,
  next_run_at DATETIME,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_report_user FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_report_active (is_active),
  INDEX idx_report_next_run (next_run_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Voice transcription records
CREATE TABLE IF NOT EXISTS voice_transcriptions (
  transcription_id VARCHAR(36) PRIMARY KEY,
  notification_id VARCHAR(36),
  user_id VARCHAR(36) NOT NULL,
  audio_file_path VARCHAR(1024),
  transcription_text TEXT,
  language VARCHAR(10),
  confidence_score DECIMAL(5,4),
  processed_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_transcription_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id) ON DELETE SET NULL,
  CONSTRAINT fk_transcription_user FOREIGN KEY (user_id) REFERENCES users(user_id),
  INDEX idx_transcription_notification (notification_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- GPS tracking for field workers
CREATE TABLE IF NOT EXISTS gps_tracking (
  tracking_id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  latitude DECIMAL(10,6) NOT NULL,
  longitude DECIMAL(10,6) NOT NULL,
  accuracy DECIMAL(10,2),
  altitude DECIMAL(10,2),
  tracking_timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activity_type VARCHAR(50),
  CONSTRAINT fk_gps_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_gps_user_time (user_id, tracking_timestamp),
  INDEX idx_gps_location (latitude, longitude)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- System settings and preferences
CREATE TABLE IF NOT EXISTS system_settings (
  setting_id VARCHAR(36) PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value JSON NOT NULL,
  description TEXT,
  updated_by VARCHAR(36),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_setting_user FOREIGN KEY (updated_by) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- User preferences
CREATE TABLE IF NOT EXISTS user_preferences (
  preference_id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  preference_key VARCHAR(100) NOT NULL,
  preference_value JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_preference_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  UNIQUE KEY uk_user_preference (user_id, preference_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Structured causal chain COD architecture (WHO standards)
CREATE TABLE IF NOT EXISTS causal_chain_cod (
  chain_id VARCHAR(36) PRIMARY KEY,
  notification_id VARCHAR(36) NOT NULL,
  underlying_cause VARCHAR(255),
  intermediate_cause VARCHAR(255),
  immediate_cause VARCHAR(255),
  contributory_conditions JSON,
  created_by VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_causal_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id) ON DELETE CASCADE,
  CONSTRAINT fk_causal_user FOREIGN KEY (created_by) REFERENCES users(user_id),
  INDEX idx_causal_notification (notification_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Standardized verbal autopsy (WHO/InterVA-5 standards)
CREATE TABLE IF NOT EXISTS verbal_autopsies (
  va_id VARCHAR(36) PRIMARY KEY,
  notification_id VARCHAR(36) NOT NULL,
  interviewer_name VARCHAR(255),
  interview_date DATETIME,
  va_data JSON NOT NULL,
  who_likely_cause VARCHAR(255),
  confidence_score DECIMAL(5,4),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_va_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id) ON DELETE CASCADE,
  INDEX idx_va_notification (notification_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Multi-expert DeCoDe panel review
CREATE TABLE IF NOT EXISTS decode_panels (
  panel_id VARCHAR(36) PRIMARY KEY,
  notification_id VARCHAR(36) NOT NULL,
  panel_lead VARCHAR(36) NOT NULL,
  panel_members JSON NOT NULL,
  consensus_cause VARCHAR(255),
  consensus_date DATETIME,
  status VARCHAR(50) DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_decode_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id) ON DELETE CASCADE,
  CONSTRAINT fk_decode_lead FOREIGN KEY (panel_lead) REFERENCES users(user_id),
  INDEX idx_decode_notification (notification_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Image annotations and diagnostic marks
CREATE TABLE IF NOT EXISTS image_annotations (
  annotation_id VARCHAR(36) PRIMARY KEY,
  image_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  annotation_type VARCHAR(50) NOT NULL,
  coordinates JSON NOT NULL,
  text_note TEXT,
  voice_note_path VARCHAR(512),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_annotation_image FOREIGN KEY (image_id) REFERENCES tele_pathology_images(image_id) ON DELETE CASCADE,
  CONSTRAINT fk_annotation_user FOREIGN KEY (user_id) REFERENCES users(user_id),
  INDEX idx_annotation_image (image_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Diagnostic peer review requests
CREATE TABLE IF NOT EXISTS peer_reviews (
  review_id VARCHAR(36) PRIMARY KEY,
  image_id VARCHAR(36) NOT NULL,
  requester_id VARCHAR(36) NOT NULL,
  reviewer_id VARCHAR(36),
  review_status VARCHAR(50) DEFAULT 'pending',
  review_notes TEXT,
  recommendation VARCHAR(255),
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  CONSTRAINT fk_review_image FOREIGN KEY (image_id) REFERENCES tele_pathology_images(image_id) ON DELETE CASCADE,
  CONSTRAINT fk_review_requester FOREIGN KEY (requester_id) REFERENCES users(user_id),
  CONSTRAINT fk_review_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_review_image (image_id),
  INDEX idx_review_reviewer (reviewer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- LIS chain-of-custody tracking
CREATE TABLE IF NOT EXISTS specimen_tracking (
  tracking_id VARCHAR(36) PRIMARY KEY,
  specimen_qr VARCHAR(255) NOT NULL UNIQUE,
  notification_id VARCHAR(36) NOT NULL,
  specimen_type VARCHAR(100) NOT NULL,
  collected_by VARCHAR(36) NOT NULL,
  collection_location VARCHAR(255),
  collection_date DATETIME NOT NULL,
  current_location VARCHAR(255),
  current_holder VARCHAR(36),
  status VARCHAR(50) DEFAULT 'in_transit',
  tracking_log JSON,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_specimen_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id) ON DELETE CASCADE,
  CONSTRAINT fk_specimen_collector FOREIGN KEY (collected_by) REFERENCES users(user_id),
  CONSTRAINT fk_specimen_holder FOREIGN KEY (current_holder) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_specimen_qr (specimen_qr),
  INDEX idx_specimen_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- CRVS integration bridge
CREATE TABLE IF NOT EXISTS crvs_bridge (
  bridge_id VARCHAR(36) PRIMARY KEY,
  notification_id VARCHAR(36) NOT NULL,
  crvs_reference_number VARCHAR(255),
  integration_status VARCHAR(50) DEFAULT 'pending',
  sent_at DATETIME,
  acknowledged_at DATETIME,
  error_message TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_crvs_notification FOREIGN KEY (notification_id) REFERENCES death_notifications(notification_id) ON DELETE CASCADE,
  INDEX idx_crvs_status (integration_status),
  INDEX idx_crvs_reference (crvs_reference_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- USSD/WhatsApp community surveillance
CREATE TABLE IF NOT EXISTS community_reports (
  report_id VARCHAR(36) PRIMARY KEY,
  reporter_phone VARCHAR(50) NOT NULL,
  report_type VARCHAR(50) NOT NULL,
  location_name VARCHAR(255),
  district VARCHAR(100),
  province VARCHAR(100),
  report_message TEXT,
  estimated_cases INT,
  severity VARCHAR(50),
  reported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified BOOLEAN DEFAULT false,
  verified_by VARCHAR(36),
  verification_notes TEXT,
  CONSTRAINT fk_community_verifier FOREIGN KEY (verified_by) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_community_district (district),
  INDEX idx_community_status (verified)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Environmental & climate data for forecasting
CREATE TABLE IF NOT EXISTS environmental_data (
  env_id VARCHAR(36) PRIMARY KEY,
  district VARCHAR(100) NOT NULL,
  data_type VARCHAR(50) NOT NULL,
  measurement_value DECIMAL(10,2),
  unit VARCHAR(50),
  recorded_at DATETIME NOT NULL,
  source VARCHAR(100),
  INDEX idx_env_district_type (district, data_type),
  INDEX idx_env_recorded (recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Patient anonymization logs
CREATE TABLE IF NOT EXISTS anonymization_logs (
  log_id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(36) NOT NULL,
  anonymized_fields JSON NOT NULL,
  access_purpose VARCHAR(100),
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_anon_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_anon_user (user_id),
  INDEX idx_anon_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Alter Existing Tables for Enhanced Features
-- ---------------------------------------------------------------------------

-- Update users table to support new roles and additional fields
ALTER TABLE users MODIFY COLUMN role VARCHAR(50) NOT NULL DEFAULT 'medical_officer';
ALTER TABLE users ADD COLUMN phone VARCHAR(50);
ALTER TABLE users ADD COLUMN department VARCHAR(100);
ALTER TABLE users ADD COLUMN profile_updated_at DATETIME;
ALTER TABLE users ADD COLUMN language VARCHAR(10) DEFAULT 'en';
ALTER TABLE users ADD COLUMN timezone VARCHAR(50) DEFAULT 'Africa/Harare';
ALTER TABLE users ADD COLUMN avatar_url VARCHAR(512);
ALTER TABLE users ADD COLUMN last_login_at DATETIME;
ALTER TABLE users ADD COLUMN failed_login_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until DATETIME;

-- Update death_notifications for international standards
ALTER TABLE death_notifications ADD COLUMN icd_version VARCHAR(10) DEFAULT 'ICD-10';
ALTER TABLE death_notifications ADD COLUMN who_notifiable BOOLEAN DEFAULT false;
ALTER TABLE death_notifications ADD COLUMN verbal_autopsy_data JSON;
ALTER TABLE death_notifications ADD COLUMN gps_coordinates JSON;
ALTER TABLE death_notifications ADD COLUMN underlying_cause VARCHAR(255);
ALTER TABLE death_notifications ADD COLUMN intermediate_cause VARCHAR(255);
ALTER TABLE death_notifications ADD COLUMN immediate_cause VARCHAR(255);
ALTER TABLE death_notifications ADD COLUMN contributory_conditions JSON;
ALTER TABLE death_notifications ADD COLUMN is_cross_border BOOLEAN DEFAULT false;
ALTER TABLE death_notifications ADD COLUMN source_country VARCHAR(100) DEFAULT 'Zimbabwe';
ALTER TABLE death_notifications ADD COLUMN travel_history TEXT;

-- Enhanced audit with IP tracking (extends existing audit_log)
ALTER TABLE audit_log ADD COLUMN session_id VARCHAR(36);
ALTER TABLE audit_log ADD COLUMN device_fingerprint VARCHAR(100);
ALTER TABLE audit_log ADD INDEX idx_audit_session (session_id);
ALTER TABLE audit_log ADD INDEX idx_audit_user_time (user_id, created_at);

-- ---------------------------------------------------------------------------
-- Data Migration: Update existing user roles from mohcc_admin to public_health_analyst
-- ---------------------------------------------------------------------------

UPDATE users SET role = 'public_health_analyst' WHERE role = 'mohcc_admin';

-- ---------------------------------------------------------------------------
-- Migration Complete
-- ---------------------------------------------------------------------------

-- Note: Email format migration should be done separately after careful planning
-- as it requires user notification and potentially grace period management