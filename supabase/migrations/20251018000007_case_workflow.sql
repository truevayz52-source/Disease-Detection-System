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
