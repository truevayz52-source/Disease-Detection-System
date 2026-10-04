-- DDS schema extension — BIIM-aligned capabilities (behavioural intelligence &
-- infodemic management) adapted to the MySQL/DDS conventions.
-- External-integration tables from the source spec (DHIS2, ODK/Kobo, Pulse GRM,
-- AI adapter, S3) are intentionally excluded — no third-party integrations.

-- ---------------------------------------------------------------------------
-- Health signals: community rumour / infodemic signal detection.
-- Signals carry status + workflow_stage/evidence/action/outcome; transitions are
-- appended to signal_workflow_events and mirrored into audit_log.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `health_signals` (
  `signal_id` VARCHAR(36) PRIMARY KEY,
  `external_id` VARCHAR(128) UNIQUE COMMENT 'Deduplication key for offline/field ingestion',
  `signal_type` VARCHAR(40) NOT NULL DEFAULT 'rumour' COMMENT 'rumour|outbreak_report|misinformation|community_alert',
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `source_channel` VARCHAR(40) NOT NULL DEFAULT 'community' COMMENT 'community|vhw|facility|media|offline',
  `district` VARCHAR(100),
  `province` VARCHAR(100),
  `facility_id` VARCHAR(36),
  `severity` VARCHAR(20) NOT NULL DEFAULT 'medium' COMMENT 'low|medium|high|critical',
  `status` VARCHAR(20) NOT NULL DEFAULT 'new' COMMENT 'new|triaged|investigating|resolved|dismissed',
  `workflow_stage` VARCHAR(30) NOT NULL DEFAULT 'captured' COMMENT 'captured|verified|escalated|closed',
  `evidence` TEXT,
  `action_taken` TEXT,
  `outcome` TEXT,
  `linked_notification_id` VARCHAR(36) COMMENT 'Death notification this signal was linked to, if any',
  `linked_alert_id` VARCHAR(36) COMMENT 'Outbreak alert this signal was linked to, if any',
  `reported_by` VARCHAR(36),
  `assigned_to` VARCHAR(36),
  `reported_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_signal_facility` FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`facility_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_signal_reporter` FOREIGN KEY (`reported_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_signal_assignee` FOREIGN KEY (`assigned_to`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_signal_notification` FOREIGN KEY (`linked_notification_id`) REFERENCES `death_notifications`(`notification_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_signal_alert` FOREIGN KEY (`linked_alert_id`) REFERENCES `outbreak_alerts`(`alert_id`) ON DELETE SET NULL,
  INDEX `idx_signal_status` (`status`),
  INDEX `idx_signal_district` (`district`),
  INDEX `idx_signal_type` (`signal_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `signal_workflow_events` (
  `event_id` VARCHAR(36) PRIMARY KEY,
  `signal_id` VARCHAR(36) NOT NULL,
  `from_stage` VARCHAR(30),
  `to_stage` VARCHAR(30) NOT NULL,
  `from_status` VARCHAR(20),
  `to_status` VARCHAR(20),
  `actor_id` VARCHAR(36),
  `actor_name` VARCHAR(255),
  `notes` TEXT,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_swe_signal` FOREIGN KEY (`signal_id`) REFERENCES `health_signals`(`signal_id`) ON DELETE CASCADE,
  INDEX `idx_swe_signal` (`signal_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Community feedback on mortality surveillance services.
CREATE TABLE IF NOT EXISTS `feedback_items` (
  `feedback_id` VARCHAR(36) PRIMARY KEY,
  `channel` VARCHAR(40) NOT NULL DEFAULT 'community',
  `subject` VARCHAR(255) NOT NULL,
  `message` TEXT,
  `district` VARCHAR(100),
  `province` VARCHAR(100),
  `sentiment` VARCHAR(20) COMMENT 'positive|neutral|negative',
  `status` VARCHAR(20) NOT NULL DEFAULT 'new' COMMENT 'new|reviewed|actioned',
  `linked_signal_id` VARCHAR(36),
  `created_by` VARCHAR(36),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_feedback_signal` FOREIGN KEY (`linked_signal_id`) REFERENCES `health_signals`(`signal_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_feedback_user` FOREIGN KEY (`created_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
  INDEX `idx_feedback_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Media monitoring — mentions relevant to mortality surveillance / infodemic.
CREATE TABLE IF NOT EXISTS `media_mentions` (
  `mention_id` VARCHAR(36) PRIMARY KEY,
  `source_name` VARCHAR(255) NOT NULL,
  `source_type` VARCHAR(40) NOT NULL DEFAULT 'news' COMMENT 'news|radio|social|print|other',
  `headline` VARCHAR(500) NOT NULL,
  `url` VARCHAR(1000),
  `summary` TEXT,
  `sentiment` VARCHAR(20),
  `topics` VARCHAR(500),
  `district` VARCHAR(100),
  `province` VARCHAR(100),
  `linked_signal_id` VARCHAR(36),
  `captured_by` VARCHAR(36),
  `published_at` DATETIME,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_media_signal` FOREIGN KEY (`linked_signal_id`) REFERENCES `health_signals`(`signal_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_media_user` FOREIGN KEY (`captured_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
  INDEX `idx_media_district` (`district`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Case investigations opened from signals or alerts.
CREATE TABLE IF NOT EXISTS `case_investigations` (
  `investigation_id` VARCHAR(36) PRIMARY KEY,
  `linked_signal_id` VARCHAR(36),
  `linked_alert_id` VARCHAR(36),
  `linked_notification_id` VARCHAR(36),
  `title` VARCHAR(255) NOT NULL,
  `findings` TEXT,
  `status` VARCHAR(20) NOT NULL DEFAULT 'open' COMMENT 'open|ongoing|concluded',
  `lead_investigator` VARCHAR(36),
  `opened_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` DATETIME,
  CONSTRAINT `fk_inv_signal` FOREIGN KEY (`linked_signal_id`) REFERENCES `health_signals`(`signal_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_inv_alert` FOREIGN KEY (`linked_alert_id`) REFERENCES `outbreak_alerts`(`alert_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_inv_notification` FOREIGN KEY (`linked_notification_id`) REFERENCES `death_notifications`(`notification_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_inv_lead` FOREIGN KEY (`lead_investigator`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
  INDEX `idx_inv_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Field / health-promotion activities.
CREATE TABLE IF NOT EXISTS `health_activities` (
  `activity_id` VARCHAR(36) PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `activity_type` VARCHAR(50) NOT NULL DEFAULT 'outreach',
  `description` TEXT,
  `district` VARCHAR(100),
  `province` VARCHAR(100),
  `facility_id` VARCHAR(36),
  `scheduled_date` DATE,
  `status` VARCHAR(20) NOT NULL DEFAULT 'planned' COMMENT 'planned|in_progress|completed|cancelled',
  `participants_reached` INT,
  `coordinator_id` VARCHAR(36),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_act_facility` FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`facility_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_act_coordinator` FOREIGN KEY (`coordinator_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
  INDEX `idx_act_district` (`district`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Health-promotion campaigns.
CREATE TABLE IF NOT EXISTS `campaigns` (
  `campaign_id` VARCHAR(36) PRIMARY KEY,
  `name` VARCHAR(255) NOT NULL,
  `objective` TEXT,
  `target_district` VARCHAR(100),
  `target_province` VARCHAR(100),
  `start_date` DATE,
  `end_date` DATE,
  `status` VARCHAR(20) NOT NULL DEFAULT 'draft' COMMENT 'draft|active|paused|completed',
  `created_by` VARCHAR(36),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_campaign_creator` FOREIGN KEY (`created_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
  INDEX `idx_campaign_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- IEC (information, education & communication) materials registry.
CREATE TABLE IF NOT EXISTS `iec_materials` (
  `material_id` VARCHAR(36) PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `material_type` VARCHAR(50) NOT NULL DEFAULT 'poster' COMMENT 'poster|leaflet|radio_spot|video|other',
  `language` VARCHAR(40) NOT NULL DEFAULT 'en' COMMENT 'en|sn|nd',
  `topic` VARCHAR(255),
  `file_path` VARCHAR(500),
  `approved` BOOLEAN NOT NULL DEFAULT false,
  `created_by` VARCHAR(36),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_iec_creator` FOREIGN KEY (`created_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Training sessions (e.g. mortality surveillance staff, community workers).
CREATE TABLE IF NOT EXISTS `trainings` (
  `training_id` VARCHAR(36) PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `audience` VARCHAR(120),
  `district` VARCHAR(100),
  `province` VARCHAR(100),
  `training_date` DATE,
  `facilitator_id` VARCHAR(36),
  `participants_count` INT,
  `status` VARCHAR(20) NOT NULL DEFAULT 'scheduled' COMMENT 'scheduled|completed|cancelled',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_training_facilitator` FOREIGN KEY (`facilitator_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Calendar events for surveillance/response planning.
CREATE TABLE IF NOT EXISTS `calendar_events` (
  `event_id` VARCHAR(36) PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `event_type` VARCHAR(50) NOT NULL DEFAULT 'general',
  `start_at` DATETIME NOT NULL,
  `end_at` DATETIME,
  `district` VARCHAR(100),
  `province` VARCHAR(100),
  `created_by` VARCHAR(36),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_cal_creator` FOREIGN KEY (`created_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
  INDEX `idx_cal_start` (`start_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Document repository metadata (files themselves live under server/uploads).
CREATE TABLE IF NOT EXISTS `documents` (
  `document_id` VARCHAR(36) PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `category` VARCHAR(60) NOT NULL DEFAULT 'general',
  `file_path` VARCHAR(500),
  `mime_type` VARCHAR(120),
  `uploaded_by` VARCHAR(36),
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_doc_uploader` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
  INDEX `idx_doc_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Communication dispatch log — records internal notifications dispatched to
-- personnel (no external SMS/WhatsApp provider integration).
CREATE TABLE IF NOT EXISTS `communications_log` (
  `comm_id` VARCHAR(36) PRIMARY KEY,
  `channel` VARCHAR(40) NOT NULL DEFAULT 'in_app' COMMENT 'in_app|email',
  `subject` VARCHAR(255) NOT NULL,
  `body` TEXT,
  `audience` VARCHAR(255),
  `sent_by` VARCHAR(36),
  `sent_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_comm_sender` FOREIGN KEY (`sent_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
