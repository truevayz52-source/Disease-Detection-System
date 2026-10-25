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
