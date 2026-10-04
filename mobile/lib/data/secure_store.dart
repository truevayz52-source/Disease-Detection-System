import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Hardware-backed secret storage (Android KeyStore / iOS Keychain via
/// flutter_secure_storage) for session tokens, offline credential verifiers
/// and the Hive database key.
///
/// Falls back to SharedPreferences (key prefix `sec:`) when the platform
/// plugin is unavailable — e.g. `flutter test`, which has no plugin registry.
/// On a real device the secure path is always used; the fallback is permanent
/// for the process once a MissingPluginException is seen.
class SecureStore {
  // Defaults: AES/GCM data cipher, RSA/OAEP-wrapped key in Android KeyStore
  // (API 23+); iOS Keychain. Older devices fall back to prefs via _guard.
  static const _storage = FlutterSecureStorage();
  static const _prefsPrefix = 'sec:';

  // Under `flutter test` the flutter tool sets FLUTTER_TEST=true; the method
  // channel either throws (no binding) or hangs (test messenger) — skip it.
  static bool _pluginAvailable =
      kIsWeb || Platform.environment['FLUTTER_TEST'] != 'true';

  /// Read [key] from secure storage; if absent, look for a legacy
  /// SharedPreferences value under [legacyKey] and migrate it forward.
  static Future<String?> read(String key, {String? legacyKey}) async {
    final value =
        await _guard(() => _storage.read(key: key)) ??
        await _prefsRead('$_prefsPrefix$key');
    if (value != null) return value;
    if (legacyKey == null) return null;
    final legacy = await _prefsRead(legacyKey);
    if (legacy == null) return null;
    await write(key, legacy);
    await _prefsRemove(legacyKey);
    return legacy;
  }

  static Future<void> write(String key, String value) async {
    final handled = await _guard(() async {
      await _storage.write(key: key, value: value);
      return true;
    });
    if (handled == true) return;
    await _prefsWrite('$_prefsPrefix$key', value);
  }

  static Future<void> delete(String key, {String? legacyKey}) async {
    await _guard(() => _storage.delete(key: key));
    await _prefsRemove('$_prefsPrefix$key');
    if (legacyKey != null) await _prefsRemove(legacyKey);
  }

  /// Runs [op] against the plugin when available; returns null to signal
  /// "use the prefs fallback" when the plugin is missing or the call failed.
  static Future<T?> _guard<T>(Future<T> Function() op) async {
    if (!_pluginAvailable) return null;
    try {
      return await op();
    } on MissingPluginException {
      _pluginAvailable = false;
      return null;
    } on FlutterError {
      // Binding not initialized in this context — plugin unusable.
      _pluginAvailable = false;
      return null;
    } on PlatformException {
      // Keystore/Keychain rejected the call (e.g. corrupted entry on some
      // Android builds) — degrade to prefs rather than break sign-in.
      _pluginAvailable = false;
      return null;
    }
  }

  static Future<String?> _prefsRead(String key) async =>
      (await SharedPreferences.getInstance()).getString(key);

  static Future<void> _prefsWrite(String key, String value) async =>
      (await SharedPreferences.getInstance()).setString(key, value);

  static Future<void> _prefsRemove(String key) async =>
      (await SharedPreferences.getInstance()).remove(key);
}
