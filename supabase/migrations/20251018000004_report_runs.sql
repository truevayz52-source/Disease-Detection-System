-- PostgreSQL port of db/004-report-runs.sql

CREATE TABLE IF NOT EXISTS report_runs (
  run_id varchar(36) PRIMARY KEY,
  report_id varchar(36) NOT NULL,
  owner_id varchar(36) NOT NULL,
  report_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_report_run FOREIGN KEY (report_id) REFERENCES scheduled_reports(report_id) ON DELETE CASCADE,
  CONSTRAINT fk_run_owner FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_report_owner ON report_runs (owner_id, created_at);
