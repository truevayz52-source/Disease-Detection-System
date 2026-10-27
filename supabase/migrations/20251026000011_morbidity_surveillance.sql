-- Morbidity (syndromic) surveillance — aggregate case counts reported by
-- facilities, labs and FHIR feeds BEFORE deaths occur. This is the true
-- pre-mortality detection feed: rows are pooled per district + disease
-- category by detection pass 5 in server/src/lib/outbreak.ts and fire
-- 'early_warning' alerts without any death notification existing.
--
-- Rows are AGGREGATES (counts per syndrome per reporting period) — no
-- patient-level PII is stored here, unlike death_notifications.

CREATE TABLE IF NOT EXISTS morbidity_reports (
  report_id varchar(36) PRIMARY KEY,
  external_id varchar(128) UNIQUE,          -- dedup key for FHIR/feed ingestion
  facility_id varchar(36),
  district varchar(100) NOT NULL,
  province varchar(100),
  syndrome varchar(60) NOT NULL,            -- acute_watery_diarrhoea|bloody_diarrhoea|jaundice|acute_respiratory_infection|febrile_rash_illness|meningitis_suspected|vector_fever|acute_fever_undifferentiated|other
  icd_code varchar(12),                     -- optional confirmed-diagnosis code; overrides the syndrome-derived category
  disease_category varchar(100) NOT NULL,   -- resolved category (icd_codes lookup when icd_code given, else syndrome map)
  case_count int NOT NULL DEFAULT 1,
  period_start date NOT NULL,               -- reporting period the count covers
  period_end date NOT NULL,
  source_channel varchar(40) NOT NULL DEFAULT 'facility', -- facility|fhir|dhis2|lab|community|offline
  severity varchar(20) NOT NULL DEFAULT 'medium',         -- low|medium|high|critical
  notes text,
  reported_by varchar(36),
  reported_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_morbidity_facility FOREIGN KEY (facility_id) REFERENCES facilities(facility_id) ON DELETE SET NULL,
  CONSTRAINT fk_morbidity_reporter FOREIGN KEY (reported_by) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_morbidity_icd FOREIGN KEY (icd_code) REFERENCES icd_codes(icd_code) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_morbidity_district_period ON morbidity_reports (district, period_start);
CREATE INDEX IF NOT EXISTS idx_morbidity_category ON morbidity_reports (disease_category);
CREATE INDEX IF NOT EXISTS idx_morbidity_syndrome ON morbidity_reports (syndrome);
CREATE INDEX IF NOT EXISTS idx_morbidity_reported_at ON morbidity_reports (reported_at);
