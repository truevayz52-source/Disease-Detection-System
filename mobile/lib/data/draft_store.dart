import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import 'local_store.dart';
import 'sync_ops.dart';

/// Backwards-compat alias — queued mutations are now [QueuedOp] (v2).
typedef QueuedItem = QueuedOp;

/// Mirrors client/src/lib/offline-queue.ts — autosaves the notification draft
/// locally and queues submissions that fail while offline for replay on
/// reconnect. Entries live in the AES-256-encrypted Hive `drafts` box
/// (patient PII); values written to SharedPreferences by older builds are
/// migrated on first access.
class DraftStore {
  static const _legacyKey = 'dds_draft_notification';
  static const _box = 'drafts';
  static const _draftId = 'notification';

  Future<Map<String, dynamic>?> loadDraft() async {
    final stored = await LocalStore.get(_box, _draftId);
    if (stored != null) return stored;
    final raw = (await SharedPreferences.getInstance()).getString(_legacyKey);
    if (raw == null) return null;
    try {
      final draft = jsonDecode(raw) as Map<String, dynamic>;
      await LocalStore.put(_box, _draftId, draft);
      await (await SharedPreferences.getInstance()).remove(_legacyKey);
      return draft;
    } catch (_) {
      return null;
    }
  }

  Future<void> saveDraft(Map<String, dynamic> data) =>
      LocalStore.put(_box, _draftId, data);

  Future<void> clearDraft() => LocalStore.delete(_box, _draftId);
}

/// Persistent FIFO queue of mutations made while offline (TC-05 parity),
/// backed by the encrypted Hive `sync_queue` box.
///
/// v2 ops ([QueuedOp]) cover every mutation kind: notification creates
/// (replayed through the batch `/offline/sync` endpoint), generic JSON
/// mutations (replayed through their canonical REST path) and multipart
/// uploads. Ops that set state on the same entity carry a `coalesceKey` —
/// enqueueing the newer one drops the older (client-side last-write-wins).
///
/// Queued ops also leave a case record in `offline_cases` so field staff can
/// review locally captured reports before they sync.
class OfflineQueue {
  static const _box = 'sync_queue';
  static const _legacyKey = 'dds_offline_queue';
  static const _uuid = Uuid();

  Future<List<QueuedOp>> entries() async {
    await _migrateLegacy();
    final items = <QueuedOp>[];
    for (final id in await LocalStore.order(_box)) {
      final raw = await LocalStore.get(_box, id);
      if (raw == null) continue;
      final op = QueuedOp.fromJson(raw);
      // Rewrite v1 entries in v2 shape on read so the store converges.
      if (raw['v'] != 2) await LocalStore.put(_box, id, op.toJson());
      items.add(op);
    }
    return items;
  }

  Future<QueuedOp> enqueueNotification(Map<String, dynamic> payload) async {
    final op = await enqueueOp(
      QueuedOp.notification(
        id: _uuid.v4(),
        payload: payload,
        queuedAt: DateTime.now(),
      ),
    );
    return op;
  }

  Future<QueuedOp> enqueueImage(String notificationId, String filePath) =>
      enqueueOp(
        QueuedOp.multipart(
          id: _uuid.v4(),
          path: '/notifications/$notificationId/images',
          filePath: filePath,
          entityType: 'death_notification',
          entityId: notificationId,
          queuedAt: DateTime.now(),
        ),
      );

  /// Enqueue [op], dropping any still-pending op with the same coalesce key
  /// (the newer write wins) and recording an `offline_cases` shadow row.
  Future<QueuedOp> enqueueOp(QueuedOp op) async {
    await _migrateLegacy();
    final key = op.effectiveCoalesceKey;
    if (key != null) {
      for (final existing in await entries()) {
        if (existing.effectiveCoalesceKey == key &&
            existing.clientUpdatedAt.isBefore(op.clientUpdatedAt)) {
          await remove(existing.id);
        }
      }
    }
    await LocalStore.put(_box, op.id, op.toJson());
    await LocalStore.enqueue(_box, op.id);
    await OfflineCaseStore.record(op);
    return op;
  }

  /// Record a failed replay attempt (attempt count + error kept for the
  /// Offline Sync screen and for per-op backoff).
  Future<void> markAttempt(String id, String error) async {
    final raw = await LocalStore.get(_box, id);
    if (raw == null) return;
    final op = QueuedOp.fromJson(raw);
    await LocalStore.put(
      _box,
      id,
      op.copyWith(attempts: op.attempts + 1, lastError: error).toJson(),
    );
  }

  Future<QueuedOp?> get(String id) async {
    final raw = await LocalStore.get(_box, id);
    return raw == null ? null : QueuedOp.fromJson(raw);
  }

  Future<void> remove(String id) async {
    await LocalStore.delete(_box, id);
    await LocalStore.dequeue(_box, id);
  }

  Future<int> count() async => (await entries()).length;

  Future<void> clear() => LocalStore.clear(_box);

  /// Copy queue entries persisted by older builds (SharedPreferences
  /// string list) into the encrypted box. Idempotent — the legacy key is
  /// removed after import so this is a no-op once migration completes.
  Future<void> _migrateLegacy() async {
    final prefs = await SharedPreferences.getInstance();
    final list = prefs.getStringList(_legacyKey);
    if (list == null || list.isEmpty) return;
    for (final s in list) {
      try {
        final op = QueuedOp.fromJson(
          (jsonDecode(s) as Map).cast<String, dynamic>(),
        );
        if (await LocalStore.get(_box, op.id) == null) {
          await LocalStore.put(_box, op.id, op.toJson());
          await LocalStore.enqueue(_box, op.id);
        }
      } catch (_) {
        /* skip malformed entry */
      }
    }
    await prefs.remove(_legacyKey);
  }
}

/// Locally captured case records in the encrypted `offline_cases` box —
/// the "offline medical forms" store. Each record mirrors a queued mutation
/// and carries a `sync_status` updated by the sync engine on replay:
/// PENDING → SYNCED, REJECTED (server refused) or CONFLICT (a newer server
/// write won under last-write-wins).
class OfflineCaseStore {
  static const _box = 'offline_cases';

  /// Record a queued mutation as a pending local case.
  static Future<void> record(QueuedOp op) => LocalStore.put(_box, op.id, {
    'local_id': op.id,
    'kind': op.kind,
    'entityType': op.entityType,
    'entityId': op.entityId,
    'path': op.path,
    'method': op.method,
    'data': op.body,
    'filePath': op.filePath,
    'clientUpdatedAt': op.clientUpdatedAt.toIso8601String(),
    'queuedAt': op.queuedAt.toIso8601String(),
    'sync_status': 'PENDING',
  });

  /// Update a record's outcome: 'SYNCED' after a successful replay,
  /// 'REJECTED' when the server refused it, 'CONFLICT' when a newer server
  /// write won. Rejected/conflict records are kept for audit.
  static Future<void> markStatus(
    String localId,
    String status, {
    String? error,
    String? serverUpdatedAt,
  }) async {
    final record = await LocalStore.get(_box, localId);
    if (record == null) return;
    record['sync_status'] = status;
    record['resolvedAt'] = DateTime.now().toIso8601String();
    if (error != null) record['lastError'] = error;
    if (serverUpdatedAt != null) record['serverUpdatedAt'] = serverUpdatedAt;
    await LocalStore.put(_box, localId, record);
  }

  /// All locally stored reports, oldest first.
  static Future<List<Map<String, dynamic>>> localReports() async =>
      await LocalStore.values(_box);

  /// Records still awaiting replay.
  static Future<List<Map<String, dynamic>>> pending() async =>
      (await localReports())
          .where((r) => r['sync_status'] == 'PENDING')
          .toList();

  static Future<void> clear() => LocalStore.clear(_box);
}
