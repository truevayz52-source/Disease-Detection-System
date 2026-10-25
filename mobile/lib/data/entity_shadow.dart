import 'local_store.dart';
import 'sync_ops.dart';

/// Per-entity shadow records in the encrypted `entity_shadow` box — the
/// optimistic-UI layer. Each entry holds the last server-known copy of an
/// entity plus a list of not-yet-synced local patches ("overlays"):
///
/// ```json
/// {
///   "data": { ...server copy... },
///   "overlays": [ {"opId": "...", "patch": {...}, "clientUpdatedAt": "..."} ],
///   "pendingOpIds": ["..."],
///   "serverUpdatedAt": "..."
/// }
/// ```
///
/// Reads merge overlays over `data` so the UI shows the user's latest intent
/// instantly. When the server version arrives (pull after flush or a normal
/// GET), last-write-wins decides: if `server.updated_at` is newer than every
/// pending overlay's `clientUpdatedAt`, the overlays are dropped and the
/// server copy wins; otherwise overlays survive until their op syncs.
class EntityShadowStore {
  static const _box = 'entity_shadow';

  static String _key(String entityType, String entityId) =>
      '$entityType:$entityId';

  /// Store the raw entry ({data, overlays, pendingOpIds, serverUpdatedAt}).
  Future<Map<String, dynamic>?> raw(String entityType, String entityId) =>
      LocalStore.get(_box, _key(entityType, entityId));

  /// Record a server-known copy of an entity (initial capture).
  Future<void> put(
    String entityType,
    String entityId,
    Map<String, dynamic> data, {
    String? serverUpdatedAt,
  }) async {
    final existing = await raw(entityType, entityId);
    await LocalStore.put(_box, _key(entityType, entityId), {
      '_k': _key(entityType, entityId),
      'data': data,
      'overlays': existing?['overlays'] ?? const [],
      'pendingOpIds': existing?['pendingOpIds'] ?? const [],
      'serverUpdatedAt':
          serverUpdatedAt ??
          data['updated_at']?.toString() ??
          existing?['serverUpdatedAt'],
    });
  }

  /// Apply an optimistic patch produced by queued op [op]. The overlay is
  /// merged into the effective view immediately and rolled back if the op is
  /// rejected or superseded.
  Future<void> applyOverlay(QueuedOp op, Map<String, dynamic> patch) async {
    if (op.entityType.isEmpty || op.entityId.isEmpty) return;
    final key = _key(op.entityType, op.entityId);
    final existing =
        (await LocalStore.get(_box, key)) ??
        <String, dynamic>{
          '_k': key,
          'data': <String, dynamic>{},
          'overlays': <Map<String, dynamic>>[],
          'pendingOpIds': <String>[],
        };
    existing['_k'] = key;
    final overlays = [
      ...(existing['overlays'] as List? ?? const [])
          .map((o) => (o as Map).cast<String, dynamic>())
          .where((o) => o['opId'] != op.id),
      {
        'opId': op.id,
        'patch': patch,
        'clientUpdatedAt': op.clientUpdatedAt.toIso8601String(),
      },
    ];
    final pending = <String>{
      ...(existing['pendingOpIds'] as List? ?? const []).cast<String>(),
      op.id,
    }.toList();
    existing['overlays'] = overlays;
    existing['pendingOpIds'] = pending;
    await LocalStore.put(_box, key, existing);
  }

  /// Remove the overlay belonging to [opId] — called when its op syncs
  /// (server copy already reflects it), is rejected (roll the UI back) or is
  /// superseded by a newer coalesced write.
  Future<void> clearOverlay(
    String entityType,
    String entityId,
    String opId,
  ) async {
    final existing = await raw(entityType, entityId);
    if (existing == null) return;
    existing['overlays'] = (existing['overlays'] as List? ?? const [])
        .map((o) => (o as Map).cast<String, dynamic>())
        .where((o) => o['opId'] != opId)
        .toList();
    existing['pendingOpIds'] = (existing['pendingOpIds'] as List? ?? const [])
        .cast<String>()
        .where((id) => id != opId)
        .toList();
    await LocalStore.put(_box, _key(entityType, entityId), existing);
  }

  /// Effective view = server copy with all pending overlays merged on top,
  /// plus `syncPending: true` while any overlay is unresolved.
  Future<Map<String, dynamic>?> effective(
    String entityType,
    String entityId,
  ) async {
    final e = await raw(entityType, entityId);
    if (e == null) return null;
    final merged = <String, dynamic>{
      ...(e['data'] as Map? ?? const {}).cast<String, dynamic>(),
    };
    for (final o in (e['overlays'] as List? ?? const [])) {
      merged.addAll(((o as Map)['patch'] as Map).cast<String, dynamic>());
    }
    if ((e['pendingOpIds'] as List? ?? const []).isNotEmpty) {
      merged['syncPending'] = true;
    }
    return merged;
  }

  /// Merge a fresh server copy into the shadow. LWW rule: if the server's
  /// [serverUpdatedAt] is newer than every pending overlay timestamp the
  /// overlays are dropped (server wins); otherwise they survive until replay.
  Future<void> resolveFromServer(
    String entityType,
    String entityId,
    Map<String, dynamic> serverData, {
    String? serverUpdatedAt,
  }) async {
    final key = _key(entityType, entityId);
    final existing = await raw(entityType, entityId);
    if (existing == null) {
      await put(
        entityType,
        entityId,
        serverData,
        serverUpdatedAt: serverUpdatedAt,
      );
      return;
    }
    final serverTs =
        DateTime.tryParse(
          serverUpdatedAt ?? serverData['updated_at']?.toString() ?? '',
        ) ??
        DateTime.fromMillisecondsSinceEpoch(0);
    final overlays = (existing['overlays'] as List? ?? const [])
        .map((o) => (o as Map).cast<String, dynamic>())
        .toList();
    final newestOverlay = overlays.fold<DateTime>(
      DateTime.fromMillisecondsSinceEpoch(0),
      (acc, o) {
        final t = DateTime.tryParse(o['clientUpdatedAt']?.toString() ?? '');
        return t != null && t.isAfter(acc) ? t : acc;
      },
    );
    existing['data'] = serverData;
    existing['serverUpdatedAt'] = serverTs.toIso8601String();
    if (serverTs.isAfter(newestOverlay)) {
      existing['overlays'] = <Map<String, dynamic>>[];
      existing['pendingOpIds'] = <String>[];
    }
    await LocalStore.put(_box, key, existing);
  }

  /// True while [entityType]/[entityId] has unresolved optimistic writes —
  /// drives "Sync pending" badges.
  Future<bool> hasPending(String entityType, String entityId) async {
    final e = await raw(entityType, entityId);
    return (e?['pendingOpIds'] as List? ?? const []).isNotEmpty;
  }

  /// All shadow entries of a type (for list merges / inspection).
  Future<List<Map<String, dynamic>>> ofType(String entityType) async {
    final prefix = '$entityType:';
    final all = await LocalStore.values(_box);
    // LocalStore.values strips meta keys but not our key namespace; the box
    // stores entries keyed under `_key`, so re-read by key prefix isn't
    // available — instead values carry their key inside `data`/`_k`.
    return all
        .where((e) => (e['_k']?.toString() ?? '').startsWith(prefix))
        .toList();
  }

  Future<void> remove(String entityType, String entityId) =>
      LocalStore.delete(_box, _key(entityType, entityId));

  static Future<void> clear() => LocalStore.clear(_box);
}
