/// API models — mirror the TypeScript interfaces in client/src/lib/types.ts
/// and the auth session shape in client/src/lib/auth.tsx.
library;

class SessionUser {
  final String userId;
  final String email;
  final String name;
  final String role;
  final String? facilityId;
  final String? province;
  final String? district;
  final String? phone;
  final String? department;
  final String language;
  final String timezone;
  final String? avatarUrl;
  final String? lastLoginAt;
  final int failedLoginAttempts;
  final String? lockedUntil;

  const SessionUser({
    required this.userId,
    required this.email,
    required this.name,
    required this.role,
    this.facilityId,
    this.province,
    this.district,
    this.phone,
    this.department,
    this.language = 'en',
    this.timezone = 'Africa/Harare',
    this.avatarUrl,
    this.lastLoginAt,
    this.failedLoginAttempts = 0,
    this.lockedUntil,
  });

  factory SessionUser.fromJson(Map<String, dynamic> j) => SessionUser(
    userId: j['userId'] as String,
    email: j['email'] as String,
    name: j['name'] as String,
    role: j['role'] as String,
    facilityId: j['facilityId'] as String?,
    province: j['province'] as String?,
    district: j['district'] as String?,
    phone: j['phone'] as String?,
    department: j['department'] as String?,
    language: j['language'] as String? ?? 'en',
    timezone: j['timezone'] as String? ?? 'Africa/Harare',
    avatarUrl: j['avatarUrl'] as String?,
    lastLoginAt: j['lastLoginAt'] as String?,
    failedLoginAttempts: (j['failedLoginAttempts'] as num?)?.toInt() ?? 0,
    lockedUntil: j['lockedUntil'] as String?,
  );
}

/// Mirrors client/src/lib/roles.ts
const kRoles = [
  'medical_officer',
  'pathologist',
  'public_health_analyst',
  'system_admin',
  'mortuary_clerk',
  'executive',
];

const kRoleLabels = {
  'medical_officer': 'Medical Officer',
  'pathologist': 'Pathologist',
  'public_health_analyst': 'Public Health Analyst',
  'system_admin': 'System Administrator',
  'mortuary_clerk': 'Mortuary Clerk',
  'executive': 'Executive',
};

class Facility {
  final String facilityId;
  final String facilityName;
  final String province;
  final String district;
  final double? latitude;
  final double? longitude;
  final String facilityType;

  const Facility({
    required this.facilityId,
    required this.facilityName,
    required this.province,
    required this.district,
    this.latitude,
    this.longitude,
    this.facilityType = '',
  });

  factory Facility.fromJson(Map<String, dynamic> j) => Facility(
    facilityId: j['facility_id'] as String,
    facilityName: j['facility_name'] as String,
    province: j['province'] as String? ?? '',
    district: j['district'] as String? ?? '',
    latitude: (j['latitude'] as num?)?.toDouble(),
    longitude: (j['longitude'] as num?)?.toDouble(),
    facilityType: j['facility_type'] as String? ?? '',
  );
}

class IcdCode {
  final String icdCode;
  final String icdVersion;
  final String description;
  final String diseaseCategory;
  final bool isNotifiable;

  const IcdCode({
    required this.icdCode,
    required this.icdVersion,
    required this.description,
    required this.diseaseCategory,
    required this.isNotifiable,
  });

  factory IcdCode.fromJson(Map<String, dynamic> j) => IcdCode(
    icdCode: j['icd_code'] as String,
    icdVersion: j['icd_version'] as String? ?? '',
    description: j['description'] as String? ?? '',
    diseaseCategory: j['disease_category'] as String? ?? '',
    isNotifiable: j['is_notifiable'] == 1 || j['is_notifiable'] == true,
  );
}

class DeathNotification {
  final String notificationId;
  final String patientId;
  final String patientName;
  final String? nationalId;
  final int? age;
  final String gender;
  final String? residentialAddress;
  final double? patientLat;
  final double? patientLng;
  final String facilityId;
  final String facilityName;
  final String district;
  final String province;
  final String dateOfDeath;
  final String preliminaryIcdCode;
  final String icdDescription;
  final String diseaseCategory;
  final String? clinicalSummary;
  final String status;
  final bool isMaternalPerinatal;
  final String reportedByName;
  final String createdAt;

  const DeathNotification({
    required this.notificationId,
    required this.patientId,
    required this.patientName,
    this.nationalId,
    this.age,
    required this.gender,
    this.residentialAddress,
    this.patientLat,
    this.patientLng,
    required this.facilityId,
    required this.facilityName,
    required this.district,
    required this.province,
    required this.dateOfDeath,
    required this.preliminaryIcdCode,
    required this.icdDescription,
    required this.diseaseCategory,
    this.clinicalSummary,
    required this.status,
    required this.isMaternalPerinatal,
    required this.reportedByName,
    required this.createdAt,
  });

  factory DeathNotification.fromJson(Map<String, dynamic> j) =>
      DeathNotification(
        notificationId: j['notification_id'] as String,
        patientId: j['patient_id'] as String? ?? '',
        patientName: j['patient_name'] as String? ?? '',
        nationalId: j['national_id'] as String?,
        age: (j['age'] as num?)?.toInt(),
        gender: j['gender'] as String? ?? '',
        residentialAddress: j['residential_address'] as String?,
        patientLat: (j['patient_lat'] as num?)?.toDouble(),
        patientLng: (j['patient_lng'] as num?)?.toDouble(),
        facilityId: j['facility_id'] as String? ?? '',
        facilityName: j['facility_name'] as String? ?? '',
        district: j['district'] as String? ?? '',
        province: j['province'] as String? ?? '',
        dateOfDeath: j['date_of_death'] as String? ?? '',
        preliminaryIcdCode: j['preliminary_icd_code'] as String? ?? '',
        icdDescription: j['icd_description'] as String? ?? '',
        diseaseCategory: j['disease_category'] as String? ?? '',
        clinicalSummary: j['clinical_summary'] as String?,
        status: j['status'] as String? ?? 'pending_review',
        isMaternalPerinatal:
            j['is_maternal_perinatal'] == 1 ||
            j['is_maternal_perinatal'] == true,
        reportedByName: j['reported_by_name'] as String? ?? '',
        createdAt: j['created_at'] as String? ?? '',
      );
}

class TelepathologyImage {
  final String imageId;
  final String? mimeType;
  final String? resolution;
  final String fileHash;
  final int originalSizeBytes;
  final String uploadedTimestamp;
  final String? uploadedByName;

  const TelepathologyImage({
    required this.imageId,
    this.mimeType,
    this.resolution,
    required this.fileHash,
    required this.originalSizeBytes,
    required this.uploadedTimestamp,
    this.uploadedByName,
  });

  factory TelepathologyImage.fromJson(Map<String, dynamic> j) =>
      TelepathologyImage(
        imageId: j['image_id'] as String,
        mimeType: j['mime_type'] as String?,
        resolution: j['resolution'] as String?,
        fileHash: j['file_hash'] as String? ?? '',
        originalSizeBytes: (j['original_size_bytes'] as num?)?.toInt() ?? 0,
        uploadedTimestamp: j['uploaded_timestamp'] as String? ?? '',
        uploadedByName: j['uploaded_by_name'] as String?,
      );
}

class AutopsyReport {
  final String autopsyId;
  final String notificationId;
  final String status;
  final String? internalObservations;
  final String? toxicologyResults;
  final bool legalThresholdFlag;
  final String? finalIcdCode;
  final String? finalCauseOfDeath;
  final String? digitalSignature;
  final String? finalizedAt;
  final String? createdAt;
  final String? pathologistName;
  final String? patientName;
  final String? facilityName;
  final String? district;

  const AutopsyReport({
    required this.autopsyId,
    required this.notificationId,
    required this.status,
    this.internalObservations,
    this.toxicologyResults,
    this.legalThresholdFlag = false,
    this.finalIcdCode,
    this.finalCauseOfDeath,
    this.digitalSignature,
    this.finalizedAt,
    this.createdAt,
    this.pathologistName,
    this.patientName,
    this.facilityName,
    this.district,
  });

  factory AutopsyReport.fromJson(Map<String, dynamic> j) => AutopsyReport(
    autopsyId: j['autopsy_id'] as String,
    notificationId: j['notification_id'] as String? ?? '',
    status: j['status'] as String? ?? 'draft',
    internalObservations: j['internal_observations'] as String?,
    toxicologyResults: j['toxicology_results'] as String?,
    legalThresholdFlag:
        j['legal_threshold_flag'] == 1 || j['legal_threshold_flag'] == true,
    finalIcdCode: j['final_icd_code'] as String?,
    finalCauseOfDeath: j['final_cause_of_death'] as String?,
    digitalSignature: j['digital_signature'] as String?,
    finalizedAt: j['finalized_at'] as String?,
    createdAt: j['created_at'] as String?,
    pathologistName: j['pathologist_name'] as String?,
    patientName: j['patient_name'] as String?,
    facilityName: j['facility_name'] as String?,
    district: j['district'] as String?,
  );
}

class OutbreakAlert {
  final String alertId;
  final String diseaseCategory;
  final String district;
  final String? clusterData;
  final int caseCount;
  final double riskScore;
  final String alertType;
  final String triggeredDate;
  final String status;
  final String? dispatchedChannels;
  final String? resolvedAt;

  const OutbreakAlert({
    required this.alertId,
    required this.diseaseCategory,
    required this.district,
    this.clusterData,
    required this.caseCount,
    required this.riskScore,
    required this.alertType,
    required this.triggeredDate,
    required this.status,
    this.dispatchedChannels,
    this.resolvedAt,
  });

  factory OutbreakAlert.fromJson(Map<String, dynamic> j) => OutbreakAlert(
    alertId: j['alert_id'] as String,
    diseaseCategory: j['disease_category'] as String? ?? '',
    district: j['district'] as String? ?? '',
    clusterData: j['cluster_data'] as String?,
    caseCount: (j['case_count'] as num?)?.toInt() ?? 0,
    riskScore: (j['risk_score'] as num?)?.toDouble() ?? 0,
    alertType: j['alert_type'] as String? ?? 'outbreak',
    triggeredDate: j['triggered_date'] as String? ?? '',
    status: j['status'] as String? ?? 'active',
    dispatchedChannels: j['dispatched_channels'] as String?,
    resolvedAt: j['resolved_at'] as String?,
  );
}

class AlertStats {
  final int active;
  final int resolved;
  final int critical;
  final int highRisk;
  final int activeCases;
  final int total;

  const AlertStats({
    this.active = 0,
    this.resolved = 0,
    this.critical = 0,
    this.highRisk = 0,
    this.activeCases = 0,
    this.total = 0,
  });

  factory AlertStats.fromJson(Map<String, dynamic> j) => AlertStats(
    active: (j['active'] as num?)?.toInt() ?? 0,
    resolved: (j['resolved'] as num?)?.toInt() ?? 0,
    critical: (j['critical'] as num?)?.toInt() ?? 0,
    highRisk: (j['highRisk'] as num?)?.toInt() ?? 0,
    activeCases: (j['activeCases'] as num?)?.toInt() ?? 0,
    total: (j['total'] as num?)?.toInt() ?? 0,
  );
}

class DashboardKpis {
  final int deathsLast7Days;
  final int deathsPrev7Days;
  final int pendingReviews;
  final int activeAlerts;
  final int finalizedAutopsies;
  final int mpdsrLast30Days;
  final int mpdsrPrev30Days;
  final int totalNotifications;

  const DashboardKpis({
    this.deathsLast7Days = 0,
    this.deathsPrev7Days = 0,
    this.pendingReviews = 0,
    this.activeAlerts = 0,
    this.finalizedAutopsies = 0,
    this.mpdsrLast30Days = 0,
    this.mpdsrPrev30Days = 0,
    this.totalNotifications = 0,
  });

  factory DashboardKpis.fromJson(Map<String, dynamic> j) => DashboardKpis(
    deathsLast7Days: (j['deathsLast7Days'] as num?)?.toInt() ?? 0,
    deathsPrev7Days: (j['deathsPrev7Days'] as num?)?.toInt() ?? 0,
    pendingReviews: (j['pendingReviews'] as num?)?.toInt() ?? 0,
    activeAlerts: (j['activeAlerts'] as num?)?.toInt() ?? 0,
    finalizedAutopsies: (j['finalizedAutopsies'] as num?)?.toInt() ?? 0,
    mpdsrLast30Days: (j['mpdsrLast30Days'] as num?)?.toInt() ?? 0,
    mpdsrPrev30Days: (j['mpdsrPrev30Days'] as num?)?.toInt() ?? 0,
    totalNotifications: (j['totalNotifications'] as num?)?.toInt() ?? 0,
  );
}

class CountPoint {
  final String label;
  final int count;
  const CountPoint(this.label, this.count);
}

class DashboardData {
  final DashboardKpis kpis;
  final List<CountPoint> daily; // label = ISO day
  final List<CountPoint> weekly; // label = ISO week start
  final List<CountPoint> byCategory;
  final List<CountPoint> byProvince;
  final List<CountPoint> byStatus;

  const DashboardData({
    required this.kpis,
    required this.daily,
    required this.weekly,
    required this.byCategory,
    required this.byProvince,
    required this.byStatus,
  });

  factory DashboardData.fromJson(Map<String, dynamic> j) => DashboardData(
    kpis: DashboardKpis.fromJson(j['kpis'] as Map<String, dynamic>? ?? {}),
    daily: _points(j['daily'], 'day'),
    weekly: _points(j['weekly'], 'week'),
    byCategory: _points(j['byCategory'], 'category'),
    byProvince: _points(j['byProvince'], 'province'),
    byStatus: _points(j['byStatus'], 'status'),
  );

  static List<CountPoint> _points(dynamic list, String key) =>
      ((list as List?) ?? [])
          .map(
            (e) => CountPoint(
              (e as Map)[key]?.toString() ?? '',
              (e['count'] as num).toInt(),
            ),
          )
          .toList();
}

class UserRow {
  final String userId;
  final String fullName;
  final String email;
  final String role;
  final String status;
  final String? facilityId;
  final String? facilityName;
  final String createdAt;

  const UserRow({
    required this.userId,
    required this.fullName,
    required this.email,
    required this.role,
    required this.status,
    this.facilityId,
    this.facilityName,
    required this.createdAt,
  });

  factory UserRow.fromJson(Map<String, dynamic> j) => UserRow(
    userId: j['user_id'] as String,
    fullName: j['full_name'] as String? ?? '',
    email: j['email'] as String? ?? '',
    role: j['role'] as String? ?? '',
    status: j['status'] as String? ?? '',
    facilityId: j['facility_id'] as String?,
    facilityName: j['facility_name'] as String?,
    createdAt: j['created_at'] as String? ?? '',
  );
}

class AuditRow {
  final String auditId;
  final String action;
  final String entityType;
  final String? entityId;
  final String? ipAddress;
  final String? details;
  final String recordHash;
  final String createdAt;
  final String? userName;

  const AuditRow({
    required this.auditId,
    required this.action,
    required this.entityType,
    this.entityId,
    this.ipAddress,
    this.details,
    required this.recordHash,
    required this.createdAt,
    this.userName,
  });

  factory AuditRow.fromJson(Map<String, dynamic> j) => AuditRow(
    auditId: j['audit_id'] as String,
    action: j['action'] as String? ?? '',
    entityType: j['entity_type'] as String? ?? '',
    entityId: j['entity_id'] as String?,
    ipAddress: j['ip_address'] as String?,
    details: j['details']?.toString(),
    recordHash: j['record_hash'] as String? ?? '',
    createdAt: j['created_at'] as String? ?? '',
    userName: j['user_name'] as String?,
  );
}

class Cluster {
  final String category;
  final String? district;
  final String? province;
  final int count;
  final double centroidLat;
  final double centroidLng;
  final String source;

  const Cluster({
    required this.category,
    this.district,
    this.province,
    required this.count,
    required this.centroidLat,
    required this.centroidLng,
    this.source = 'node',
  });

  factory Cluster.fromJson(Map<String, dynamic> j) => Cluster(
    category: j['category'] as String? ?? '',
    district: j['district'] as String?,
    province: j['province'] as String?,
    count: (j['count'] as num?)?.toInt() ?? 0,
    centroidLat: (j['centroid_lat'] as num?)?.toDouble() ?? 0,
    centroidLng: (j['centroid_lng'] as num?)?.toDouble() ?? 0,
    source: j['source'] as String? ?? 'node',
  );
}
