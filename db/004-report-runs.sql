CREATE TABLE IF NOT EXISTS report_runs (
  run_id VARCHAR(36) PRIMARY KEY,
  report_id VARCHAR(36) NOT NULL,
  owner_id VARCHAR(36) NOT NULL,
  report_data JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES scheduled_reports(report_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_report_owner (owner_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
