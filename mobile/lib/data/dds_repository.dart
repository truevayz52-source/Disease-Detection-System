import 'api_client.dart';
import 'models.dart';

/// Repository for all DDS REST endpoints used by the mobile app.
/// Mirrors the fetch calls in the web client's pages (client/src/pages/*).
class DdsRepository {
  DdsRepository(this._api);

  final ApiClient _api;

  // ── Dashboard / analytics ────────────────────────────────────────────────

  Future<DashboardData> dashboard() async =>
      DashboardData.fromJson(await _api.get('/analytics/dashboard'));

  Future<Map<String, dynamic>> trends({int weeks = 12}) async =>
      await _api.get('/analytics/trends', query: {'weeks': '$weeks'});

  Future<List<Cluster>> clusters() async {
    final res = await _api.get('/analytics/clusters');
    return ((res['clusters'] as List?) ?? [])
        .map((e) => Cluster.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<String> engine() async =>
      (await _api.get('/analytics/clusters'))['engine']?.toString() ??
      'unknown';

  Future<int> detectOutbreaks() async {
    final res = await _api.post('/analytics/detect');
    return (res['created'] as List?)?.length ?? 0;
  }

  // ── Notifications ────────────────────────────────────────────────────────

  Future<List<DeathNotification>> notifications({
    String? q,
    String? status,
    String? district,
  }) async {
    final res = await _api.get(
      '/notifications',
      query: {
        if (q != null && q.isNotEmpty) 'q': q,
        if (status != null && status != 'all') 'status': status,
        if (district != null && district != 'all') 'district': district,
      },
    );
    return ((res['items'] as List?) ?? [])
        .map((e) => DeathNotification.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<NotificationDetail> notification(String id) async {
    final res = await _api.get('/notifications/$id');
    return NotificationDetail(
      notification: DeathNotification.fromJson(
        res['notification'] as Map<String, dynamic>,
      ),
      images: ((res['images'] as List?) ?? [])
          .map((e) => TelepathologyImage.fromJson(e as Map<String, dynamic>))
          .toList(),
      autopsy: res['autopsy'] == null
          ? null
          : AutopsyReport.fromJson(res['autopsy'] as Map<String, dynamic>),
    );
  }

  /// POST /notifications — returns notificationId (+ any alerts raised).
  Future<NotificationCreated> createNotification(
    Map<String, dynamic> payload,
  ) async {
    final res = await _api.post('/notifications', body: payload);
    return NotificationCreated(
      notificationId: res['notificationId'] as String,
      mpdsrAlertId: res['mpdsrAlertId'] as String?,
      alertsCreated: (res['alertsCreated'] as List?)?.length ?? 0,
    );
  }

  Future<void> uploadImage(String notificationId, String filePath) =>
      _api.uploadImage(notificationId, filePath);

  /// Autopsy save/finalize from the pathology review flow.
  Future<void> saveAutopsy(
    String notificationId,
    Map<String, dynamic> form, {
    required bool finalize,
  }) => _api.post(
    '/notifications/$notificationId/autopsy',
    body: {...form, 'finalize': finalize},
  );

  // ── Facilities & ICD ─────────────────────────────────────────────────────

  Future<List<Facility>> facilities() async {
    final res = await _api.get('/facilities');
    return ((res['items'] as List?) ?? [])
        .map((e) => Facility.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<List<IcdCode>> icdCodes(String q) async {
    final res = await _api.get('/icd-codes', query: {if (q.isNotEmpty) 'q': q});
    return ((res['items'] as List?) ?? [])
        .map((e) => IcdCode.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  // ── Alerts ───────────────────────────────────────────────────────────────

  Future<List<OutbreakAlert>> alerts({String? status, String? type}) async {
    final res = await _api.get(
      '/alerts',
      query: {
        if (status != null && status != 'all') 'status': status,
        if (type != null && type != 'all') 'type': type,
      },
    );
    return ((res['items'] as List?) ?? [])
        .map((e) => OutbreakAlert.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<AlertStats> alertStats() async =>
      AlertStats.fromJson(await _api.get('/alerts/stats'));

  Future<void> resolveAlert(String id) => _api.patch('/alerts/$id/resolve');

  // ── Autopsies ────────────────────────────────────────────────────────────

  Future<List<AutopsyReport>> autopsies() async {
    final res = await _api.get('/autopsies');
    return ((res['items'] as List?) ?? [])
        .map((e) => AutopsyReport.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<AutopsyReport> autopsy(String id) async => AutopsyReport.fromJson(
    (await _api.get('/autopsies/$id'))['autopsy'] as Map<String, dynamic>,
  );

  Future<void> finalizeAutopsy(String id) =>
      _api.patch('/autopsies/$id/finalize');

  // ── AI (guarded Gemini via /api/ai — server re-masks before dispatch) ──────

  /// Text must already be masked by the caller (deidentify.dart) — this repo
  /// method just forwards; the server privacy gate verifies masking again.
  Future<String> aiSummarize(
    String maskedText,
    List<String> pii,
    String lang,
  ) async {
    final res = await _api.post(
      '/ai/summarize',
      body: {'text': maskedText, 'pii': pii, 'lang': lang},
    );
    return res['summary']?.toString() ?? '';
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  Future<List<UserRow>> users() async {
    final res = await _api.get('/users');
    return ((res['items'] as List?) ?? [])
        .map((e) => UserRow.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<List<AuditRow>> audit({String? q, int page = 1}) async {
    final res = await _api.get(
      '/audit',
      query: {if (q != null && q.isNotEmpty) 'q': q, 'page': '$page'},
    );
    return ((res['items'] as List?) ?? [])
        .map((e) => AuditRow.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<Map<String, dynamic>> auditVerify() async =>
      await _api.get('/audit/verify');

  /// Admin system settings (`GET /settings/all`) — raw rows, values are
  /// JSON-encoded strings.
  Future<List<Map<String, dynamic>>> systemSettings() async {
    final res = await _api.get('/settings/all');
    return ((res['items'] as List?) ?? [])
        .map((e) => (e as Map).cast<String, dynamic>())
        .toList();
  }

  /// Admin integration availability (`GET /integrations/status`) — service
  /// name → status string map.
  Future<Map<String, dynamic>> integrationsStatus() async =>
      ((await _api.get('/integrations/status')) as Map).cast<String, dynamic>();

  /// `PATCH /settings/:key` — keys are whitelisted server-side
  /// (site_notice, maintenance_message, gps_retention_days).
  Future<void> saveSetting(String key, Object value) =>
      _api.patch('/settings/$key', body: {'value': value});

  /// `POST /regional/push` — pushes the district-level mortality aggregate
  /// to the configured exchange targets (DHIS2 / OpenHIM). Returns the
  /// per-target result list.
  Future<Map<String, dynamic>> regionalPush({int days = 30}) async =>
      ((await _api.post('/regional/push', body: {'days': days})) as Map)
          .cast<String, dynamic>();
}

class NotificationDetail {
  final DeathNotification notification;
  final List<TelepathologyImage> images;
  final AutopsyReport? autopsy;
  const NotificationDetail({
    required this.notification,
    required this.images,
    this.autopsy,
  });
}

class NotificationCreated {
  final String notificationId;
  final String? mpdsrAlertId;
  final int alertsCreated;
  const NotificationCreated({
    required this.notificationId,
    this.mpdsrAlertId,
    this.alertsCreated = 0,
  });
}
