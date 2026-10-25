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
