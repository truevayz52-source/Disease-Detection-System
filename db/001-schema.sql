-- Disease Detection System (DDS) relational schema (MySQL 8 / MariaDB 10.4)
-- Chapter 4, section 4.5 — Database Design.
-- Auth: stateful JWT (sessions table) + Argon2 password hashes per Chapter 4.7/5.3.

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- Reference + auth tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `facilities` (
  `facility_id` VARCHAR(36) PRIMARY KEY,
  `facility_name` VARCHAR(255) NOT NULL,
  `province` VARCHAR(100) NOT NULL,
  `district` VARCHAR(100) NOT NULL,
  `latitude` DECIMAL(10,6) NOT NULL,
  `longitude` DECIMAL(10,6) NOT NULL,
  `facility_type` VARCHAR(60) NOT NULL DEFAULT 'district_hospital',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `users` (
  `user_id` VARCHAR(36) PRIMARY KEY,
  `full_name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` VARCHAR(40) NOT NULL DEFAULT 'medical_officer',
  `facility_id` VARCHAR(36),
  `status` VARCHAR(20) NOT NULL DEFAULT 'active',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_user_facility` FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`facility_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Stateful JWT sessions: server can revoke a token before it expires (Ch 4.7).
CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id` VARCHAR(36) PRIMARY KEY,
  `user_id` VARCHAR(36) NOT NULL,
  `token_hash` VARCHAR(128) NOT NULL UNIQUE,
  `expires_at` DATETIME NOT NULL,
  `ip_address` VARCHAR(64),
  `user_agent` VARCHAR(512),
  `revoked` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_session_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE,
  INDEX `idx_session_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Domain tables (Chapter 4.5)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `icd_codes` (
  `icd_code` VARCHAR(12) PRIMARY KEY,
  `icd_version` VARCHAR(6) NOT NULL DEFAULT 'ICD-10',
  `description` VARCHAR(255) NOT NULL,
  `disease_category` VARCHAR(100) NOT NULL,
  `is_notifiable` BOOLEAN NOT NULL DEFAULT false
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `patients` (
  `patient_id` VARCHAR(36) PRIMARY KEY,
  `national_id` VARCHAR(60),
  `full_name` VARCHAR(255) NOT NULL,
  `age` INT,
  `gender` VARCHAR(20) NOT NULL,
  `residential_address` VARCHAR(512),
  `latitude` DECIMAL(10,6),
  `longitude` DECIMAL(10,6),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_patient_national_id` (`national_id`),
  INDEX `idx_patient_name` (`full_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `death_notifications` (
  `notification_id` VARCHAR(36) PRIMARY KEY,
  `patient_id` VARCHAR(36) NOT NULL,
  `facility_id` VARCHAR(36) NOT NULL,
  `date_of_death` DATETIME NOT NULL,
  `preliminary_icd_code` VARCHAR(12) NOT NULL,
  `clinical_summary` TEXT,
  `reported_by` VARCHAR(36) NOT NULL,
  `status` VARCHAR(40) NOT NULL DEFAULT 'pending_review',
  `is_maternal_perinatal` BOOLEAN NOT NULL DEFAULT false,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_dn_patient` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`patient_id`),
  CONSTRAINT `fk_dn_facility` FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`facility_id`),
  CONSTRAINT `fk_dn_icd` FOREIGN KEY (`preliminary_icd_code`) REFERENCES `icd_codes`(`icd_code`),
  CONSTRAINT `fk_dn_reporter` FOREIGN KEY (`reported_by`) REFERENCES `users`(`user_id`),
  INDEX `idx_dn_facility_date` (`facility_id`, `date_of_death`),
  INDEX `idx_dn_icd_date` (`preliminary_icd_code`, `date_of_death`),
  INDEX `idx_dn_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `tele_pathology_images` (
  `image_id` VARCHAR(36) PRIMARY KEY,
  `notification_id` VARCHAR(36) NOT NULL,
  `file_path` VARCHAR(1024) NOT NULL,
  `mime_type` VARCHAR(80),
  `resolution` VARCHAR(40),
  `file_hash` VARCHAR(128) NOT NULL,
  `original_size_bytes` BIGINT,
  `compressed_size_bytes` BIGINT,
  `compressed` BOOLEAN NOT NULL DEFAULT false,
  `uploaded_by` VARCHAR(36) NOT NULL,
  `uploaded_timestamp` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_img_notification` FOREIGN KEY (`notification_id`) REFERENCES `death_notifications`(`notification_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_img_uploader` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`user_id`),
  INDEX `idx_img_notification` (`notification_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `autopsy_reports` (
  `autopsy_id` VARCHAR(36) PRIMARY KEY,
  `notification_id` VARCHAR(36) NOT NULL UNIQUE,
  `pathologist_id` VARCHAR(36) NOT NULL,
  `internal_observations` TEXT,
  `toxicology_results` TEXT,
  `legal_threshold_flag` BOOLEAN NOT NULL DEFAULT false,
  `final_icd_code` VARCHAR(12),
  `final_cause_of_death` VARCHAR(512),
  `digital_signature` VARCHAR(255),
  `audit_hash` VARCHAR(128) NOT NULL,
  `status` VARCHAR(40) NOT NULL DEFAULT 'draft',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finalized_at` DATETIME,
  CONSTRAINT `fk_autopsy_notification` FOREIGN KEY (`notification_id`) REFERENCES `death_notifications`(`notification_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_autopsy_pathologist` FOREIGN KEY (`pathologist_id`) REFERENCES `users`(`user_id`),
  CONSTRAINT `fk_autopsy_icd` FOREIGN KEY (`final_icd_code`) REFERENCES `icd_codes`(`icd_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `outbreak_alerts` (
  `alert_id` VARCHAR(36) PRIMARY KEY,
  `disease_category` VARCHAR(100) NOT NULL,
  `district` VARCHAR(100) NOT NULL,
  `cluster_data` JSON,
  `case_count` INT NOT NULL DEFAULT 0,
  `risk_score` DECIMAL(5,2) NOT NULL DEFAULT 0,
  `alert_type` VARCHAR(40) NOT NULL DEFAULT 'outbreak',
  `triggered_date` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status` VARCHAR(40) NOT NULL DEFAULT 'active',
  `dispatched_channels` VARCHAR(255),
  `resolved_at` DATETIME,
  INDEX `idx_alert_status` (`status`),
  INDEX `idx_alert_district` (`district`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Immutable, tamper-evident audit chain (Ch 4.7): each row's record_hash covers
-- the row payload plus the previous row's hash, so altering history is detectable.
CREATE TABLE IF NOT EXISTS `audit_log` (
  `audit_id` VARCHAR(36) PRIMARY KEY,
  `user_id` VARCHAR(36),
  `action` VARCHAR(100) NOT NULL,
  `entity_type` VARCHAR(60) NOT NULL,
  `entity_id` VARCHAR(36),
  `ip_address` VARCHAR(64),
  `details` JSON,
  `record_hash` VARCHAR(128) NOT NULL,
  `previous_hash` VARCHAR(128),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_audit_entity` (`entity_type`, `entity_id`),
  INDEX `idx_audit_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
