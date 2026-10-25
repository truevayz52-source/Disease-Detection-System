-- Disease Detection System (DDS) schema extension — MPDSR review stages.
-- Turns mpdsr_workflows from a single status flag into a real review
-- pipeline (notified → in_review → actions_assigned → completed) with
-- cause classification, preventability, contributing factors and a
-- tracked corrective-action list (the WHO "closed loop").

SET NAMES utf8mb4;

-- ---------------------------------------------------------------------------
-- mpdsr_workflows review fields
-- ---------------------------------------------------------------------------
ALTER TABLE mpdsr_workflows ADD COLUMN review_scheduled_at DATETIME;
ALTER TABLE mpdsr_workflows ADD COLUMN reviewed_at DATETIME;
ALTER TABLE mpdsr_workflows ADD COLUMN review_panel VARCHAR(500);
ALTER TABLE mpdsr_workflows ADD COLUMN cause_classification VARCHAR(40)
  COMMENT 'direct_obstetric|indirect_obstetric|coincidental|undetermined';
ALTER TABLE mpdsr_workflows ADD COLUMN preventability VARCHAR(30)
  COMMENT 'preventable|potentially_preventable|not_preventable|undetermined';
ALTER TABLE mpdsr_workflows ADD COLUMN contributing_factors TEXT
  COMMENT 'JSON array of contributing factor strings';
ALTER TABLE mpdsr_workflows ADD COLUMN review_due_at DATETIME
  COMMENT 'Facility-level review target — notification + 7 days';
ALTER TABLE mpdsr_workflows ADD COLUMN completed_at DATETIME;

-- response_status becomes the canonical review stage.
ALTER TABLE mpdsr_workflows MODIFY COLUMN response_status VARCHAR(30)
  NOT NULL DEFAULT 'notified'
  COMMENT 'notified|in_review|actions_assigned|completed';
UPDATE mpdsr_workflows SET response_status = 'notified'        WHERE response_status = 'pending';
UPDATE mpdsr_workflows SET response_status = 'in_review'       WHERE response_status IN ('investigating', 'in_progress', 'investigation');
UPDATE mpdsr_workflows SET response_status = 'completed'       WHERE response_status = 'closed';
UPDATE mpdsr_workflows SET review_due_at = DATE_ADD(COALESCE(notification_timestamp, created_at), INTERVAL 7 DAY)
  WHERE review_due_at IS NULL;
UPDATE mpdsr_workflows SET completed_at = updated_at
  WHERE response_status = 'completed' AND completed_at IS NULL;

-- ---------------------------------------------------------------------------
-- mpdsr_actions — corrective actions tracked to completion (closed loop).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mpdsr_actions` (
  `action_id` VARCHAR(36) PRIMARY KEY,
  `workflow_id` VARCHAR(36) NOT NULL,
  `action_text` VARCHAR(500) NOT NULL,
  `responsible_party` VARCHAR(255),
  `due_date` DATE,
  `status` VARCHAR(20) NOT NULL DEFAULT 'open' COMMENT 'open|done|cancelled',
  `created_by` VARCHAR(36),
  `completed_by` VARCHAR(36),
  `completed_at` DATETIME,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_mpdsr_action_workflow` FOREIGN KEY (`workflow_id`) REFERENCES `mpdsr_workflows`(`workflow_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mpdsr_action_creator` FOREIGN KEY (`created_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_mpdsr_action_completer` FOREIGN KEY (`completed_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
  INDEX `idx_mpdsr_action_workflow` (`workflow_id`),
  INDEX `idx_mpdsr_action_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
