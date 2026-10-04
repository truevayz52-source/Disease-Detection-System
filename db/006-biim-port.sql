-- DDS schema — BIIMZim port (hierarchical scoping, SLA, classifier output,
-- playbooks, evidence attachments, login/password history).
-- Excludes external-integration tables (DHIS2/ODK/Pulse/AI adapter).

-- ---------------------------------------------------------------------------
-- Geographic reference (Zimbabwe): 10 provinces — "National" deliberately
-- excluded per requirement; it is a scope level, not a province.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `provinces` (
  `province_id` VARCHAR(36) PRIMARY KEY,
  `province_name` VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `districts` (
  `district_id` VARCHAR(36) PRIMARY KEY,
  `province` VARCHAR(100) NOT NULL,
  `district` VARCHAR(100) NOT NULL,
  UNIQUE KEY `uq_province_district` (`province`, `district`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Hierarchical scoping attributes on users (BIIM scope_clause equivalent).
ALTER TABLE users ADD COLUMN province VARCHAR(100);
ALTER TABLE users ADD COLUMN district VARCHAR(100);

-- Signal SLA + rules-classifier output columns.
ALTER TABLE health_signals ADD COLUMN sla_due_at DATETIME;
ALTER TABLE health_signals ADD COLUMN sla_breached BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE health_signals ADD COLUMN risk_score INT;
ALTER TABLE health_signals ADD COLUMN classified_topics VARCHAR(500);
ALTER TABLE health_signals ADD COLUMN sentiment VARCHAR(20);
ALTER TABLE health_signals ADD COLUMN classified_drivers VARCHAR(500);

ALTER TABLE community_reports ADD COLUMN risk_score INT;
ALTER TABLE community_reports ADD COLUMN classified_topics VARCHAR(500);
ALTER TABLE community_reports ADD COLUMN sentiment VARCHAR(20);

-- BIIM sourceId for facility-merge dedup.
ALTER TABLE facilities ADD COLUMN source_id VARCHAR(40);
ALTER TABLE facilities ADD INDEX idx_facility_source_id (source_id);

-- ---------------------------------------------------------------------------
-- Evidence attachments for signals / grievances / notifications.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `evidence_files` (
  `evidence_id` VARCHAR(36) PRIMARY KEY,
  `entity_type` VARCHAR(30) NOT NULL COMMENT 'signal|notification',
  `entity_id` VARCHAR(36) NOT NULL,
  `file_path` VARCHAR(500) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(120),
  `size_bytes` INT,
  `uploaded_by` VARCHAR(36),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_evidence_uploader` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
  INDEX `idx_evidence_entity` (`entity_type`, `entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Response playbooks — predefined action templates attachable to signals.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `response_playbooks` (
  `playbook_id` VARCHAR(36) PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `signal_type` VARCHAR(40) COMMENT 'Signal type this playbook targets (NULL = any)',
  `disease_category` VARCHAR(100),
  `steps` JSON NOT NULL COMMENT 'Ordered list of recommended response actions',
  `created_by` VARCHAR(36),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_playbook_creator` FOREIGN KEY (`created_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `signal_playbook_links` (
  `signal_id` VARCHAR(36) NOT NULL,
  `playbook_id` VARCHAR(36) NOT NULL,
  `attached_by` VARCHAR(36),
  `attached_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`signal_id`, `playbook_id`),
  CONSTRAINT `fk_spl_signal` FOREIGN KEY (`signal_id`) REFERENCES `health_signals`(`signal_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_spl_playbook` FOREIGN KEY (`playbook_id`) REFERENCES `response_playbooks`(`playbook_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_spl_user` FOREIGN KEY (`attached_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Auth forensics: every login attempt + previous password hashes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `login_history` (
  `history_id` VARCHAR(36) PRIMARY KEY,
  `user_id` VARCHAR(36),
  `email` VARCHAR(255) NOT NULL,
  `success` BOOLEAN NOT NULL,
  `failure_reason` VARCHAR(120),
  `ip_address` VARCHAR(64),
  `user_agent` VARCHAR(512),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_loginhist_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
  INDEX `idx_loginhist_email` (`email`),
  INDEX `idx_loginhist_time` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `password_history` (
  `history_id` VARCHAR(36) PRIMARY KEY,
  `user_id` VARCHAR(36) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_pwhist_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE,
  INDEX `idx_pwhist_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
