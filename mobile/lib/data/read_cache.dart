import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'local_store.dart';

/// Offline read cache — stores successful GET response bodies so screens can
/// render last-known data with no network. Entries live in the AES-256
/// encrypted Hive `read_cache` box keyed by request URI.
///
/// Older builds cached responses in plaintext SharedPreferences under
/// `cache:<uri>` / `cache_ts:<uri>`; those are migrated into the box on first
/// access (per key) and wiped on "remove offline access" sign-out together
/// with the box itself.
class ReadCache {
  static const _box = 'read_cache';
  static const _legacyBodyPrefix = 'cache:';
  static const _legacyTsPrefix = 'cache_ts:';

  /// Cached response body for [uri], or null when absent/malformed.
  Future<String?> get(String uri) async {
    final stored = await LocalStore.get(_box, uri);
    if (stored != null) return stored['body']?.toString();
    return _migrate(uri);
  }

  /// Raw cached body decoded as JSON, or null when absent.
  Future<dynamic> getJson(String uri) async {
    final body = await get(uri);
    if (body == null) return null;
    try {
      return jsonDecode(body);
    } catch (_) {
      return null;
    }
  }

  /// When [uri] was last fetched live; null when never cached.
  Future<DateTime?> fetchedAt(String uri) async {
    final stored = await LocalStore.get(_box, uri);
    if (stored != null) return DateTime.tryParse('${stored['fetchedAt']}');
    final prefs = await SharedPreferences.getInstance();
    final ts = prefs.getString('$_legacyTsPrefix$uri');
    return ts == null ? null : DateTime.tryParse(ts);
  }

  /// Persist a live response body under [uri].
  Future<void> put(String uri, String body) => LocalStore.put(_box, uri, {
    'body': body,
    'fetchedAt': DateTime.now().toIso8601String(),
  });

  Future<void> remove(String uri) => LocalStore.delete(_box, uri);

  /// Drop every cached read — used by "remove offline access" sign-out and by
  /// the account-wipe path. Also purges any legacy prefs entries.
  Future<void> clear() async {
    await LocalStore.clear(_box);
    final prefs = await SharedPreferences.getInstance();
    for (final key in prefs.getKeys().toList()) {
      if (key.startsWith(_legacyBodyPrefix) ||
          key.startsWith(_legacyTsPrefix)) {
        await prefs.remove(key);
      }
    }
  }

  /// Copy a legacy SharedPreferences entry into the box on first miss.
  Future<String?> _migrate(String uri) async {
    final prefs = await SharedPreferences.getInstance();
    final body = prefs.getString('$_legacyBodyPrefix$uri');
    if (body == null) return null;
    final ts = prefs.getString('$_legacyTsPrefix$uri');
    await LocalStore.put(_box, uri, {
      'body': body,
      'fetchedAt': ts ?? DateTime.now().toIso8601String(),
    });
    await prefs.remove('$_legacyBodyPrefix$uri');
    await prefs.remove('$_legacyTsPrefix$uri');
    return body;
  }
}
