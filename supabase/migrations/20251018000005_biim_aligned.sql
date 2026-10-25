-- PostgreSQL port of db/005-biim-aligned.sql
-- DDS schema extension - BIIM-aligned capabilities (behavioural intelligence &
-- infodemic management). External-integration tables intentionally excluded.

-- ---------------------------------------------------------------------------
-- Health signals: community death reporting / mortality surveillance signal
-- detection. Transitions are appended to signal_workflow_events and mirrored
-- into audit_log.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS health_signals (
  signal_id varchar(36) PRIMARY KEY,
  external_id varchar(128) UNIQUE,          -- deduplication key for offline/field ingestion
  signal_type varchar(40) NOT NULL DEFAULT 'unreported_death', -- unreported_death|suspicious_death|maternal_perinatal|death_cluster|community_alert
  title varchar(255) NOT NULL,
  description text,
  source_channel varchar(40) NOT NULL DEFAULT 'community', -- community|vhw|facility|police|media|offline
  district varchar(100),
  province varchar(100),
  facility_id varchar(36),
  severity varchar(20) NOT NULL DEFAULT 'medium', -- low|medium|high|critical
  status varchar(20) NOT NULL DEFAULT 'new',     -- new|triaged|investigating|resolved|dismissed
  workflow_stage varchar(30) NOT NULL DEFAULT 'captured', -- captured|verified|escalated|closed
  evidence text,
  action_taken text,
  outcome text,
  linked_notification_id varchar(36),          -- death notification this signal was linked to, if any
  linked_alert_id varchar(36),                 -- outbreak alert this signal was linked to, if any
  reported_by varchar(36),
  assigned_to varchar(36),
  reported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_signal_facility FOREIGN KEY (facility_id) REFERENCES facilities(facility_id) ON DELETE SET NULL,
  CONSTRAINT fk_signal_reporter FOREIGN KEY (reported_by) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_signal_assignee FOREIGN KEY (assigned_to) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_signal_notification FOREIGN KEY (linked_notification_id) REFERENCES death_notifications(notification_id) ON DELETE SET NULL,
  CONSTRAINT fk_signal_alert FOREIGN KEY (linked_alert_id) REFERENCES outbreak_alerts(alert_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_signal_status ON health_signals (status);
CREATE INDEX IF NOT EXISTS idx_signal_district ON health_signals (district);
CREATE INDEX IF NOT EXISTS idx_signal_type ON health_signals (signal_type);
CREATE OR REPLACE TRIGGER trg_health_signals_updated_at
  BEFORE UPDATE ON health_signals FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS signal_workflow_events (
  event_id varchar(36) PRIMARY KEY,
  signal_id varchar(36) NOT NULL,
  from_stage varchar(30),
  to_stage varchar(30) NOT NULL,
  from_status varchar(20),
  to_status varchar(20),
  actor_id varchar(36),
  actor_name varchar(255),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_swe_signal FOREIGN KEY (signal_id) REFERENCES health_signals(signal_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_swe_signal ON signal_workflow_events (signal_id);

-- Community feedback on mortality surveillance services.
CREATE TABLE IF NOT EXISTS feedback_items (
  feedback_id varchar(36) PRIMARY KEY,
  channel varchar(40) NOT NULL DEFAULT 'community',
  subject varchar(255) NOT NULL,
  message text,
  district varchar(100),
  province varchar(100),
  sentiment varchar(20),                       -- positive|neutral|negative
  status varchar(20) NOT NULL DEFAULT 'new',   -- new|reviewed|actioned
  linked_signal_id varchar(36),
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_feedback_signal FOREIGN KEY (linked_signal_id) REFERENCES health_signals(signal_id) ON DELETE SET NULL,
  CONSTRAINT fk_feedback_user FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback_items (status);

-- Media monitoring - mentions relevant to mortality surveillance / infodemic.
CREATE TABLE IF NOT EXISTS media_mentions (
  mention_id varchar(36) PRIMARY KEY,
  source_name varchar(255) NOT NULL,
  source_type varchar(40) NOT NULL DEFAULT 'news', -- news|radio|social|print|other
  headline varchar(500) NOT NULL,
  url varchar(1000),
  summary text,
  sentiment varchar(20),
  topics varchar(500),
  district varchar(100),
  province varchar(100),
  linked_signal_id varchar(36),
  captured_by varchar(36),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_media_signal FOREIGN KEY (linked_signal_id) REFERENCES health_signals(signal_id) ON DELETE SET NULL,
  CONSTRAINT fk_media_user FOREIGN KEY (captured_by) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_media_district ON media_mentions (district);

-- Case investigations opened from signals or alerts.
CREATE TABLE IF NOT EXISTS case_investigations (
  investigation_id varchar(36) PRIMARY KEY,
  linked_signal_id varchar(36),
  linked_alert_id varchar(36),
  linked_notification_id varchar(36),
  title varchar(255) NOT NULL,
  findings text,
  status varchar(20) NOT NULL DEFAULT 'open',  -- open|ongoing|concluded
  lead_investigator varchar(36),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT fk_inv_signal FOREIGN KEY (linked_signal_id) REFERENCES health_signals(signal_id) ON DELETE SET NULL,
  CONSTRAINT fk_inv_alert FOREIGN KEY (linked_alert_id) REFERENCES outbreak_alerts(alert_id) ON DELETE SET NULL,
  CONSTRAINT fk_inv_notification FOREIGN KEY (linked_notification_id) REFERENCES death_notifications(notification_id) ON DELETE SET NULL,
  CONSTRAINT fk_inv_lead FOREIGN KEY (lead_investigator) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_status ON case_investigations (status);

-- Field / health-promotion activities.
CREATE TABLE IF NOT EXISTS health_activities (
  activity_id varchar(36) PRIMARY KEY,
  title varchar(255) NOT NULL,
  activity_type varchar(50) NOT NULL DEFAULT 'outreach',
  description text,
  district varchar(100),
  province varchar(100),
  facility_id varchar(36),
  scheduled_date date,
  status varchar(20) NOT NULL DEFAULT 'planned', -- planned|in_progress|completed|cancelled
  participants_reached integer,
  coordinator_id varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_act_facility FOREIGN KEY (facility_id) REFERENCES facilities(facility_id) ON DELETE SET NULL,
  CONSTRAINT fk_act_coordinator FOREIGN KEY (coordinator_id) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_act_district ON health_activities (district);

-- Health-promotion campaigns.
CREATE TABLE IF NOT EXISTS campaigns (
  campaign_id varchar(36) PRIMARY KEY,
  name varchar(255) NOT NULL,
  objective text,
  target_district varchar(100),
  target_province varchar(100),
  start_date date,
  end_date date,
  status varchar(20) NOT NULL DEFAULT 'draft',   -- draft|active|paused|completed
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_campaign_creator FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_campaign_status ON campaigns (status);

-- IEC (information, education & communication) materials registry.
CREATE TABLE IF NOT EXISTS iec_materials (
  material_id varchar(36) PRIMARY KEY,
  title varchar(255) NOT NULL,
  material_type varchar(50) NOT NULL DEFAULT 'poster', -- poster|leaflet|radio_spot|video|other
  language varchar(40) NOT NULL DEFAULT 'en',        -- en|sn|nd
  topic varchar(255),
  file_path varchar(500),
  approved boolean NOT NULL DEFAULT false,
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_iec_creator FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Training sessions (mortality surveillance staff, community workers).
CREATE TABLE IF NOT EXISTS trainings (
  training_id varchar(36) PRIMARY KEY,
  title varchar(255) NOT NULL,
  audience varchar(120),
  district varchar(100),
  province varchar(100),
  training_date date,
  facilitator_id varchar(36),
  participants_count integer,
  status varchar(20) NOT NULL DEFAULT 'scheduled', -- scheduled|completed|cancelled
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_training_facilitator FOREIGN KEY (facilitator_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Calendar events for surveillance/response planning.
CREATE TABLE IF NOT EXISTS calendar_events (
  event_id varchar(36) PRIMARY KEY,
  title varchar(255) NOT NULL,
  description text,
  event_type varchar(50) NOT NULL DEFAULT 'general',
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  district varchar(100),
  province varchar(100),
  created_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_cal_creator FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_cal_start ON calendar_events (start_at);

-- Document repository metadata (files themselves live under server/uploads).
CREATE TABLE IF NOT EXISTS documents (
  document_id varchar(36) PRIMARY KEY,
  title varchar(255) NOT NULL,
  category varchar(60) NOT NULL DEFAULT 'general',
  file_path varchar(500),
  mime_type varchar(120),
  uploaded_by varchar(36),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_doc_uploader FOREIGN KEY (uploaded_by) REFERENCES users(user_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_doc_category ON documents (category);

-- Communication dispatch log - internal notifications to personnel.
CREATE TABLE IF NOT EXISTS communications_log (
  comm_id varchar(36) PRIMARY KEY,
  channel varchar(40) NOT NULL DEFAULT 'in_app',  -- in_app|email
  subject varchar(255) NOT NULL,
  body text,
  audience varchar(255),
  sent_by varchar(36),
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_comm_sender FOREIGN KEY (sent_by) REFERENCES users(user_id) ON DELETE SET NULL
);
