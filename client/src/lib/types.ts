export interface Facility {
  facility_id: string
  facility_name: string
  province: string
  district: string
  latitude: number
  longitude: number
  facility_type: string
}

export interface IcdCode {
  icd_code: string
  icd_version: string
  description: string
  disease_category: string
  is_notifiable: number | boolean
}

export interface DeathNotification {
  notification_id: string
  patient_id: string
  patient_name: string
  national_id: string | null
  age: number | null
  gender: string
  residential_address: string | null
  patient_lat: number | null
  patient_lng: number | null
  facility_id: string
  facility_name: string
  district: string
  province: string
  date_of_death: string
  preliminary_icd_code: string
  icd_description: string
  disease_category: string
  clinical_summary: string | null
  status: "pending_review" | "under_review" | "autopsy_complete" | "finalized"
  is_maternal_perinatal: number
  reported_by_name: string
  created_at: string
}

export interface TelepathologyImage {
  image_id: string
  mime_type: string | null
  resolution: string | null
  file_hash: string
  original_size_bytes: number
  compressed_size_bytes: number | null
  compressed: number
  uploaded_timestamp: string
  uploaded_by_name?: string
}

export interface AutopsyReport {
  autopsy_id: string
  notification_id: string
  status: "draft" | "finalized"
  internal_observations?: string | null
  toxicology_results?: string | null
  legal_threshold_flag: number
  final_icd_code: string | null
  final_cause_of_death: string | null
  digital_signature?: string | null
  finalized_at: string | null
  created_at?: string
  pathologist_name?: string
  patient_name?: string
  facility_name?: string
  district?: string
}

export interface OutbreakAlert {
  alert_id: string
  disease_category: string
  district: string
  cluster_data: string | null
  case_count: number
  risk_score: number
  alert_type: "outbreak" | "mpdsr"
  triggered_date: string
  status: "active" | "resolved"
  dispatched_channels: string | null
  resolved_at: string | null
}

export interface UserRow {
  user_id: string
  full_name: string
  email: string
  role: string
  status: string
  facility_id: string | null
  facility_name: string | null
  created_at: string
}

export interface AuditRow {
  audit_id: string
  action: string
  entity_type: string
  entity_id: string | null
  ip_address: string | null
  details: string | null
  record_hash: string
  created_at: string
  user_name: string | null
}
