import 'dart:convert';

import 'package:hive_flutter/hive_flutter.dart';

import 'secure_store.dart';

/// Encrypted on-device database (Hive, AES-256) for offline medical records:
///
///   - `offline_cases` — case records captured offline, keyed by local id,
///     each carrying a `sync_status` of PENDING / SYNCED / REJECTED.
///   - `sync_queue` — FIFO outbox of mutations awaiting replay; item order is
///     held explicitly under `__order__` since box key order isn't guaranteed.
///   - `drafts` — autosaved form drafts (patient PII — must stay encrypted).
///
/// The AES key is generated once via [Hive.generateSecureKey] and kept in
/// [SecureStore] (Android KeyStore / iOS Keychain). When the Hive or
/// path_provider plugin is unavailable (e.g. `flutter test`), boxes degrade
/// to a process-local in-memory map so callers keep working.
class LocalStore {
  static const _keyName = 'hive_db_key';
  static const _orderMeta = '__order__';

  static bool _initialized = false;
  static bool _hiveReady = false;
  static HiveAesCipher? _cipher;
  static final _boxes = <String, Box>{};
  static final _memory = <String, Map<String, dynamic>>{};

  /// Open the store. Called once from main() before runApp; safe to call
  /// again — subsequent calls are no-ops.
  static Future<void> init() async {
    if (_initialized) return;
    _initialized = true;
    try {
      await Hive.initFlutter();
      var keyStr = await SecureStore.read(_keyName);
      List<int> key;
      if (keyStr == null) {
        key = Hive.generateSecureKey();
        await SecureStore.write(_keyName, base64UrlEncode(key));
      } else {
        key = base64Url.decode(keyStr);
      }
      _cipher = HiveAesCipher(key);
      _hiveReady = true;
    } catch (_) {
      _hiveReady = false; // plugin unavailable — in-memory fallback
    }
  }

  static Future<Map<String, dynamic>?> get(String box, String key) async {
    if (_hiveReady) {
      final raw = (await _box(box)).get(key);
      return raw == null ? null : (raw as Map).cast<String, dynamic>();
    }
    return _mem(box)[key] as Map<String, dynamic>?;
  }

  static Future<void> put(
    String box,
    String key,
    Map<String, dynamic> value,
  ) async {
    if (_hiveReady) {
      await (await _box(box)).put(key, value);
      return;
    }
    _mem(box)[key] = value;
  }

  static Future<void> delete(String box, String key) async {
    if (_hiveReady) {
      await (await _box(box)).delete(key);
      return;
    }
    _mem(box).remove(key);
  }

  /// All stored maps in [box], excluding `__`-prefixed meta entries.
  static Future<List<Map<String, dynamic>>> values(String box) async {
    if (_hiveReady) {
      final b = await _box(box);
      return b.keys
          .where((k) => k is String && !k.startsWith('__'))
          .map((k) => b.get(k))
          .whereType<Map>()
          .map((m) => m.cast<String, dynamic>())
          .toList();
    }
    return _mem(
      box,
    ).entries
        .where((e) => !e.key.startsWith('__'))
        .map((e) => (e.value as Map).cast<String, dynamic>())
        .toList();
  }

  // --- FIFO order helpers (sync_queue) ---

  /// Ids in enqueue order for [box]; used by OfflineQueue for FIFO replay.
  static Future<List<String>> order(String box) async {
    final raw = _hiveReady
        ? (await _box(box)).get(_orderMeta)
        : _mem(box)[_orderMeta];
    if (raw is List) return raw.cast<String>();
    if (raw is String) {
      try {
        return (jsonDecode(raw) as List).cast<String>();
      } catch (_) {
        /* fall through */
      }
    }
    return const [];
  }

  static Future<void> enqueue(String box, String id) async {
    final ids = [...await order(box), id];
    await _putMeta(box, _orderMeta, ids);
  }

  static Future<void> dequeue(String box, String id) async {
    final ids = (await order(box))..remove(id);
    await _putMeta(box, _orderMeta, ids);
  }

  static Future<void> clear(String box) async {
    if (_hiveReady) {
      await (await _box(box)).clear();
      return;
    }
    _mem(box).clear();
  }

  // --- internals ---

  static Future<void> _putMeta(String box, String key, Object value) async {
    if (_hiveReady) {
      await (await _box(box)).put(key, value);
      return;
    }
    _mem(box)[key] = value;
  }

  static Future<Box> _box(String name) async =>
      _boxes[name] ??= await Hive.openBox(name, encryptionCipher: _cipher);

  static Map<String, dynamic> _mem(String name) => _memory[name] ??= {};
}
