import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import 'local_store.dart';
import '../l10n/app_localizations.dart';

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

/// A queued offline mutation. [type] is 'notification' or 'image'.
class QueuedItem {
  final String id;
  final String type;
  final Map<String, dynamic> data;
  final DateTime queuedAt;

  const QueuedItem({
    required this.id,
    required this.type,
    required this.data,
    required this.queuedAt,
  });

  factory QueuedItem.fromJson(Map<String, dynamic> j) => QueuedItem(
    id: j['id'] as String,
    type: j['type'] as String,
    data: (j['data'] as Map).cast<String, dynamic>(),
    queuedAt:
        DateTime.tryParse(j['queuedAt']?.toString() ?? '') ?? DateTime.now(),
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'type': type,
    'data': data,
    'queuedAt': queuedAt.toIso8601String(),
  };

  /// Short human summary for the Offline Sync screen.
  String describe() => switch (type) {
    'notification' => tr('Death notification — {name}', {
      'name': data['patient']?['fullName'] ?? tr('unknown patient'),
    }),
    'image' => tr('Pathology image → case {id}', {
      'id': data['notificationId'] ?? '?',
    }),
    _ => type,
  };
}

/// Persistent FIFO queue of mutations made while offline (TC-05 parity),
/// backed by the encrypted Hive `sync_queue` box. Queued notifications also
/// leave a case record in `offline_cases` so field staff can review locally
/// captured reports before they sync.
class OfflineQueue {
  static const _box = 'sync_queue';
  static const _legacyKey = 'dds_offline_queue';
  static const _uuid = Uuid();

  Future<List<QueuedItem>> entries() async {
    await _migrateLegacy();
    final items = <QueuedItem>[];
    for (final id in await LocalStore.order(_box)) {
      final raw = await LocalStore.get(_box, id);
      if (raw != null) items.add(QueuedItem.fromJson(raw));
    }
    return items;
  }

  Future<QueuedItem> enqueueNotification(Map<String, dynamic> payload) async {
    final item = await _add(
      QueuedItem(
        id: _uuid.v4(),
        type: 'notification',
        data: payload,
        queuedAt: DateTime.now(),
      ),
    );
    await OfflineCaseStore.record(item);
    return item;
  }

  Future<QueuedItem> enqueueImage(String notificationId, String filePath) =>
      _add(
        QueuedItem(
          id: _uuid.v4(),
          type: 'image',
          data: {'notificationId': notificationId, 'filePath': filePath},
          queuedAt: DateTime.now(),
        ),
      );

  Future<QueuedItem> _add(QueuedItem item) async {
    await _migrateLegacy();
    await LocalStore.put(_box, item.id, item.toJson());
    await LocalStore.enqueue(_box, item.id);
    return item;
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
        final item = QueuedItem.fromJson(
          (jsonDecode(s) as Map).cast<String, dynamic>(),
        );
        if (await LocalStore.get(_box, item.id) == null) {
          await LocalStore.put(_box, item.id, item.toJson());
          await LocalStore.enqueue(_box, item.id);
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
/// and carries a `sync_status` updated by SyncService on replay.
class OfflineCaseStore {
  static const _box = 'offline_cases';

  /// Record a queued mutation as a pending local case.
  static Future<void> record(QueuedItem item) => LocalStore.put(_box, item.id, {
    'local_id': item.id,
    'type': item.type,
    'data': item.data,
    'queuedAt': item.queuedAt.toIso8601String(),
    'sync_status': 'PENDING',
  });

  /// Update a record's outcome: 'SYNCED' after a successful replay,
  /// 'REJECTED' when the server refused it (kept for audit).
  static Future<void> markStatus(String localId, String status) async {
    final record = await LocalStore.get(_box, localId);
    if (record == null) return;
    record['sync_status'] = status;
    record['resolvedAt'] = DateTime.now().toIso8601String();
    await LocalStore.put(_box, localId, record);
  }

  /// All locally stored reports, oldest first.
  static Future<List<Map<String, dynamic>>> localReports() async =>
      await LocalStore.values(_box);

  static Future<void> clear() => LocalStore.clear(_box);
}
