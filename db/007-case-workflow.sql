-- Disease Detection System (DDS) schema extension — case workflow integrity.
-- Adds rejected/assigned/SLA tracking on death_notifications, medical
-- officer MCCD certification table, autopsy signature HMACs, and a link
-- from verified community reports to health_signals.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- death_notifications workflow fields
-- ---------------------------------------------------------------------------
ALTER TABLE death_notifications ADD COLUMN rejection_reason TEXT;
ALTER TABLE death_notifications ADD COLUMN rejected_by VARCHAR(36);
ALTER TABLE death_notifications ADD COLUMN rejected_at DATETIME;
ALTER TABLE death_notifications ADD COLUMN assigned_to VARCHAR(36);
ALTER TABLE death_notifications ADD COLUMN review_due_at DATETIME;

-- ---------------------------------------------------------------------------
-- autopsy report signature integrity
-- ---------------------------------------------------------------------------
ALTER TABLE autopsy_reports ADD COLUMN signature_hmac VARCHAR(128);

-- ---------------------------------------------------------------------------
-- community report → health_signal linkage
-- ---------------------------------------------------------------------------
ALTER TABLE community_reports ADD COLUMN linked_signal_id VARCHAR(36);

-- ---------------------------------------------------------------------------
-- Medical officer MCCD certification (non-medico-legal deaths).
-- Mirrors autopsy_reports for the certificate path but is distinct:
-- only medical officers certify natural-cause deaths without autopsy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `medical_certifications` (
  `certification_id` VARCHAR(36) PRIMARY KEY,
  `notification_id` VARCHAR(36) NOT NULL UNIQUE,
  `certified_by` VARCHAR(36) NOT NULL,
  `final_icd_code` VARCHAR(12) NOT NULL,
  `final_cause_of_death` VARCHAR(512) NOT NULL,
  `manner_of_death` VARCHAR(40) NOT NULL DEFAULT 'natural',
  `signer_name` VARCHAR(255) NOT NULL,
  `signature_hmac` VARCHAR(128) NOT NULL,
  `audit_hash` VARCHAR(128) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_cert_notification` FOREIGN KEY (`notification_id`) REFERENCES `death_notifications`(`notification_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cert_user` FOREIGN KEY (`certified_by`) REFERENCES `users`(`user_id`),
  CONSTRAINT `fk_cert_icd` FOREIGN KEY (`final_icd_code`) REFERENCES `icd_codes`(`icd_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
