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
