import '../l10n/app_localizations.dart';

/// A queued offline mutation — sync_queue schema v2.
///
/// Kinds:
///   - `notification` — death-notification create. Replays through the batch
///     `/offline/sync` endpoint; idempotent because the server dedupes on
///     `submissionId` (= this op's [id]).
///   - `http` — generic JSON mutation replayed through its canonical REST
///     path ([method] + [path] + [body]). `clientUpdatedAt` is injected into
///     the outgoing body so server-side last-write-wins guards can compare
///     it against the row's `updated_at`.
///   - `multipart` — file upload replayed via multipart POST ([path] +
///     [filePath] + [fields]): pathology images, signal evidence.
///
/// [coalesceKey] implements client-side last-write-wins: two pending ops
/// that write the same state to the same entity can't both be needed, so
/// enqueueing the newer one drops the older. Defaults to `'METHOD path'`
/// for PATCH ops (set-state semantics); set-state POSTs pass an explicit
/// key; creates and file uploads never coalesce.
class QueuedOp {
  final String id;
  final int v;
  final String kind;
  final String? method;
  final String? path;
  final Map<String, dynamic> body;
  final String? filePath;
  final Map<String, String> fields;

  /// Entity this op mutates — used for shadow records, overlay bookkeeping
  /// and queue coalescing. Empty for freestanding ops.
  final String entityType;
  final String entityId;

  /// When the user made this change on-device — the LWW timestamp compared
  /// against the server's `updated_at` on replay.
  final DateTime clientUpdatedAt;
  final DateTime queuedAt;
  final int attempts;
  final String? lastError;
  final String? coalesceKey;

  const QueuedOp({
    required this.id,
    this.v = 2,
    required this.kind,
    this.method,
    this.path,
    this.body = const {},
    this.filePath,
    this.fields = const {},
    this.entityType = '',
    this.entityId = '',
    required this.clientUpdatedAt,
    required this.queuedAt,
    this.attempts = 0,
    this.lastError,
    this.coalesceKey,
  });

  /// Default coalesce key: PATCH ops collapse on `method:path`. Anything
  /// that should collapse regardless of method passes an explicit
  /// [coalesceKey] in the constructor.
  String? get effectiveCoalesceKey =>
      coalesceKey ?? (method == 'PATCH' && path != null ? 'PATCH:$path' : null);

  String get entityKey =>
      entityType.isEmpty ? '' : '$entityType:$entityId';

  factory QueuedOp.notification({
    required String id,
    required Map<String, dynamic> payload,
    required DateTime queuedAt,
  }) => QueuedOp(
    id: id,
    kind: 'notification',
    body: payload,
    entityType: 'death_notification',
    entityId: id,
    clientUpdatedAt: queuedAt,
    queuedAt: queuedAt,
  );

  factory QueuedOp.http({
    required String id,
    required String method,
    required String path,
    Map<String, dynamic> body = const {},
    String entityType = '',
    String entityId = '',
    String? coalesceKey,
    required DateTime queuedAt,
  }) => QueuedOp(
    id: id,
    kind: 'http',
    method: method,
    path: path,
    body: body,
    entityType: entityType,
    entityId: entityId,
    coalesceKey: coalesceKey,
    clientUpdatedAt: queuedAt,
    queuedAt: queuedAt,
  );

  factory QueuedOp.multipart({
    required String id,
    required String path,
    required String filePath,
    Map<String, String> fields = const {},
    String entityType = '',
    String entityId = '',
    required DateTime queuedAt,
  }) => QueuedOp(
    id: id,
    kind: 'multipart',
    path: path,
    filePath: filePath,
    fields: fields,
    entityType: entityType,
    entityId: entityId,
    clientUpdatedAt: queuedAt,
    queuedAt: queuedAt,
  );

  /// Translate a v1 queue entry ({id,type:'notification'|'image',data,
  /// queuedAt}) into a v2 op. Returns null for unknown v1 types.
  static QueuedOp? fromV1(Map<String, dynamic> j) {
    final data = (j['data'] as Map?)?.cast<String, dynamic>() ?? const {};
    final queuedAt =
        DateTime.tryParse(j['queuedAt']?.toString() ?? '') ?? DateTime.now();
    final id = j['id']?.toString() ?? '';
    return switch (j['type']) {
      'notification' => QueuedOp.notification(
        id: id,
        payload: data,
        queuedAt: queuedAt,
      ),
      'image' => QueuedOp.multipart(
        id: id,
        path: '/notifications/${data['notificationId']}/images',
        filePath: data['filePath']?.toString() ?? '',
        entityType: 'death_notification',
        entityId: data['notificationId']?.toString() ?? '',
        queuedAt: queuedAt,
      ),
      _ => null,
    };
  }

  factory QueuedOp.fromJson(Map<String, dynamic> j) {
    if (j['v'] != 2) {
      final op = fromV1(j);
      if (op != null) return op;
    }
    return QueuedOp(
      id: j['id'] as String,
      v: 2,
      kind: j['kind']?.toString() ?? 'http',
      method: j['method']?.toString(),
      path: j['path']?.toString(),
      body: (j['body'] as Map?)?.cast<String, dynamic>() ?? const {},
      filePath: j['filePath']?.toString(),
      fields:
          (j['fields'] as Map?)?.map(
            (k, v) => MapEntry(k.toString(), v.toString()),
          ) ??
          const {},
      entityType: j['entityType']?.toString() ?? '',
      entityId: j['entityId']?.toString() ?? '',
      clientUpdatedAt:
          DateTime.tryParse(j['clientUpdatedAt']?.toString() ?? '') ??
          DateTime.now(),
      queuedAt:
          DateTime.tryParse(j['queuedAt']?.toString() ?? '') ?? DateTime.now(),
      attempts: (j['attempts'] as num?)?.toInt() ?? 0,
      lastError: j['lastError']?.toString(),
      coalesceKey: j['coalesceKey']?.toString(),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'v': v,
    'kind': kind,
    if (method != null) 'method': method,
    if (path != null) 'path': path,
    'body': body,
    if (filePath != null) 'filePath': filePath,
    if (fields.isNotEmpty) 'fields': fields,
    'entityType': entityType,
    'entityId': entityId,
    'clientUpdatedAt': clientUpdatedAt.toIso8601String(),
    'queuedAt': queuedAt.toIso8601String(),
    'attempts': attempts,
    if (lastError != null) 'lastError': lastError,
    if (coalesceKey != null) 'coalesceKey': coalesceKey,
  };

  QueuedOp copyWith({int? attempts, String? lastError}) => QueuedOp(
    id: id,
    v: v,
    kind: kind,
    method: method,
    path: path,
    body: body,
    filePath: filePath,
    fields: fields,
    entityType: entityType,
    entityId: entityId,
    clientUpdatedAt: clientUpdatedAt,
    queuedAt: queuedAt,
    attempts: attempts ?? this.attempts,
    lastError: lastError ?? this.lastError,
    coalesceKey: coalesceKey,
  );

  /// Body sent on the wire — injects the LWW timestamp so server-side guards
  /// can compare it with the row's updated_at. Unknown keys are stripped by
  /// the server's (non-strict) zod schemas where unused.
  Map<String, dynamic> wireBody() => {
    ...body,
    'clientUpdatedAt': clientUpdatedAt.toIso8601String(),
  };

  /// Short human summary for the Offline Sync screen.
  String describe() => switch (kind) {
    'notification' => tr('Death notification — {name}', {
      'name': body['patient']?['fullName'] ?? tr('unknown patient'),
    }),
    'multipart' => tr('File upload → {path}', {'path': path ?? '?'}),
    'http' => tr('{method} {path}', {
      'method': method ?? 'POST',
      'path': path ?? '?',
    }),
    _ => kind,
  };
}
