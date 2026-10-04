import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

import 'secure_store.dart';
import '../l10n/app_localizations.dart';

/// Why an offline credential check failed.
enum OfflineAuthError {
  accountNotFound,
  wrongPassword,
  twoFactorRequired,
  sessionExpired,
}

class OfflineAuthException implements Exception {
  OfflineAuthException(this.kind, this.message);

  final OfflineAuthError kind;
  final String message;

  @override
  String toString() => message;
}

/// A device-activated offline account: an Argon2id password verifier plus a
/// snapshot of the last session (user profile + JWT) so the app can sign in
/// and render cached data with no network.
class OfflineAccount {
  final String email;
  final Map<String, dynamic> user;
  final String? token;
  final DateTime savedAt;
  final bool has2fa;

  const OfflineAccount({
    required this.email,
    required this.user,
    this.token,
    required this.savedAt,
    this.has2fa = false,
  });
}

/// Stores per-account offline credentials in [SecureStore] (Android KeyStore /
/// iOS Keychain) under `dds_offline_account:<email>` — legacy blobs written to
/// SharedPreferences by older builds are migrated on first read. The verifier
/// is an Argon2id hash of the password with a per-account random salt — the
/// raw password is never persisted. Accounts that completed a 2FA step online
/// are recorded without a verifier so offline sign-in can refuse them cleanly.
class OfflineAccountStore {
  static const _prefix = 'dds_offline_account:';

  /// How long a device-activated account may sign in without contacting the
  /// server, counting from the last successful online login or session
  /// refresh (`lastOnlineAt`).
  static const offlineSessionTtl = Duration(days: 14);

  static final _argon2 = Argon2id(
    memory: 32768,
    parallelism: 2,
    iterations: 2,
    hashLength: 32,
  );
  static final _rng = Random.secure();

  String _key(String email) => '$_prefix${email.trim().toLowerCase()}';

  /// Record/refresh an account after a successful ONLINE login. When
  /// [has2fa] is true no verifier is written — the password alone is not
  /// enough to unlock that account offline.
  Future<void> save({
    required String email,
    required String? password,
    required Map<String, dynamic> user,
    required String? token,
    bool has2fa = false,
  }) async {
    final existing = await _readBlob(email);
    String? salt = existing?['salt'] as String?;
    String? hash = existing?['hash'] as String?;
    if (!has2fa && password != null) {
      salt = base64Encode(
        Uint8List.fromList(List.generate(16, (_) => _rng.nextInt(256))),
      );
      final key = await _argon2.deriveKeyFromPassword(
        password: password,
        nonce: base64Decode(salt),
      );
      hash = base64Encode(await key.extractBytes());
    }
    final now = DateTime.now().toIso8601String();
    await SecureStore.write(
      _key(email),
      jsonEncode({
        'v': 1,
        'email': email.trim().toLowerCase(),
        'salt': salt,
        'hash': hash,
        'user': user,
        'token': token,
        'has2fa': has2fa || (existing?['has2fa'] == true),
        'savedAt': now,
        'lastOnlineAt': now,
      }),
    );
  }

  /// Refresh the session snapshot (user + token) without touching the
  /// verifier — called after a successful `/auth/me` restore. Also renews
  /// `lastOnlineAt`, extending the 14-day offline window.
  Future<void> updateSession(
    String email, {
    Map<String, dynamic>? user,
    String? token,
  }) async {
    final blob = await _readBlob(email);
    if (blob == null) return;
    if (user != null) blob['user'] = user;
    if (token != null) blob['token'] = token;
    blob['lastOnlineAt'] = DateTime.now().toIso8601String();
    await SecureStore.write(_key(email), jsonEncode(blob));
  }

  /// Drop the stored JWT but keep the verifier — "keep offline access" sign-out.
  Future<void> clearToken(String email) async {
    final blob = await _readBlob(email);
    if (blob == null) return;
    blob['token'] = null;
    await SecureStore.write(_key(email), jsonEncode(blob));
  }

  /// Remove the account entirely — "remove offline access" sign-out.
  Future<void> remove(String email) async =>
      SecureStore.delete(_key(email), legacyKey: _key(email));

  /// True when this account was previously activated on the device.
  Future<bool> exists(String email) async => await _readBlob(email) != null;

  /// Verify `password` against the stored verifier. On success returns the
  /// account snapshot (user + last JWT). Throws [OfflineAuthException].
  /// Offline sign-in is refused once [offlineSessionTtl] has elapsed since
  /// the last confirmed online session.
  Future<OfflineAccount> verify(String email, String password) async {
    final blob = await _readBlob(email);
    if (blob == null || blob['hash'] == null && blob['has2fa'] != true) {
      throw OfflineAuthException(
        OfflineAuthError.accountNotFound,
        tr(
          'No offline sign-in for this account — connect once to activate it.',
        ),
      );
    }
    if (blob['has2fa'] == true) {
      throw OfflineAuthException(
        OfflineAuthError.twoFactorRequired,
        tr('This account requires a verification code — connect to sign in.'),
      );
    }
    final salt = base64Decode(blob['salt'] as String);
    final expected = base64Decode(blob['hash'] as String);
    final key = await _argon2.deriveKeyFromPassword(
      password: password,
      nonce: salt,
    );
    final actual = await key.extractBytes();
    if (!_constantTimeEquals(actual, expected)) {
      throw OfflineAuthException(
        OfflineAuthError.wrongPassword,
        tr('Incorrect password.'),
      );
    }
    final lastOnline =
        DateTime.tryParse(blob['lastOnlineAt']?.toString() ?? '') ??
        DateTime.tryParse(blob['savedAt']?.toString() ?? '') ??
        DateTime.fromMillisecondsSinceEpoch(0);
    if (DateTime.now().difference(lastOnline) > offlineSessionTtl) {
      throw OfflineAuthException(
        OfflineAuthError.sessionExpired,
        tr(
          'Offline session expired — connect to the internet to sign in again.',
        ),
      );
    }
    return OfflineAccount(
      email: blob['email'] as String,
      user: (blob['user'] as Map).cast<String, dynamic>(),
      token: blob['token'] as String?,
      savedAt:
          DateTime.tryParse(blob['savedAt']?.toString() ?? '') ??
          DateTime.now(),
      has2fa: blob['has2fa'] == true,
    );
  }

  /// Read the account blob from secure storage, migrating a legacy
  /// SharedPreferences entry on first access.
  Future<Map<String, dynamic>?> _readBlob(String email) async {
    final raw = await SecureStore.read(_key(email), legacyKey: _key(email));
    if (raw == null) return null;
    try {
      return (jsonDecode(raw) as Map).cast<String, dynamic>();
    } catch (_) {
      return null;
    }
  }

  bool _constantTimeEquals(List<int> a, List<int> b) {
    if (a.length != b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) {
      diff |= a[i] ^ b[i];
    }
    return diff == 0;
  }
}
