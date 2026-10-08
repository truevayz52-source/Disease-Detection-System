import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';
import 'biometric_auth.dart';
import 'image_cache.dart';
import 'models.dart';
import 'offline_accounts.dart';
import 'secure_store.dart';
import '../l10n/app_localizations.dart';

/// Mirrors client/src/lib/auth.tsx — owns the JWT (persisted like the web
/// app's localStorage 'dds_token'), the session user and sign-in/out.
/// Extended with offline support: the last session snapshot survives
/// restarts, and accounts activated online can sign in with no network.
class AuthRepository extends ChangeNotifier {
  AuthRepository(this._api);

  static const _tokenKey = 'dds_token';
  static const _userKey = 'dds_user';

  final ApiClient _api;
  final OfflineAccountStore _accounts = OfflineAccountStore();

  SessionUser? user;
  bool loading = true;

  /// True when the session was restored from local data or created by
  /// offline credential verification — the server has not confirmed it.
  bool offlineSession = false;

  /// Invoked after a session is established online so the app can prefetch
  /// data for offline use (wired to SyncService.prefetchBasics).
  VoidCallback? onSessionReady;

  bool get signedIn => user != null;

  /// Restore a persisted session on cold start (mirrors AuthProvider init).
  /// Never throws — falls back to the last-known user snapshot when the
  /// server is unreachable; only a definitive rejection clears the session.
  Future<void> restore() async {
    try {
      await _api.ready; // resolve a reachable server before session checks
      debugPrint('[auth] restore: reading secure store');
      _api.token = await SecureStore.read(
        _tokenKey,
        legacyKey: _tokenKey,
      ).timeout(const Duration(seconds: 10));
      final cachedUser = await SecureStore.read(_userKey, legacyKey: _userKey);
      debugPrint('[auth] restore: store ready');
      debugPrint(
        '[auth] restore: token=${_api.token != null ? 'present' : 'absent'}',
      );
      if (_api.token == null) return;
      try {
        final res = await _api
            .get('/auth/me')
            .timeout(
              const Duration(seconds: 20),
              onTimeout: () =>
                  throw ApiException(0, tr('Session check timed out')),
            );
        user = SessionUser.fromJson(res['user'] as Map<String, dynamic>);
        offlineSession = _api.lastFromCache;
        await _writeUser(res['user'] as Map<String, dynamic>);
        await _accounts.updateSession(
          user!.email,
          user: res['user'] as Map<String, dynamic>,
          token: _api.token,
        );
        debugPrint('[auth] restore: session valid for ${user?.email}');
        if (!offlineSession) onSessionReady?.call();
      } on ApiException catch (e) {
        if (e.status == 0 && cachedUser != null) {
          // Server unreachable — keep the session on last-known data.
          debugPrint('[auth] restore: offline, using cached session');
          try {
            user = SessionUser.fromJson(
              jsonDecode(cachedUser) as Map<String, dynamic>,
            );
            offlineSession = true;
          } catch (_) {
            user = null;
          }
        } else {
          // Expired/invalid session — clear and require a fresh sign-in.
          debugPrint('[auth] restore: session rejected: $e');
          user = null;
        }
        if (user == null) {
          _api.token = null;
          offlineSession = false;
          await _clearSession();
        }
      } catch (e) {
        debugPrint('[auth] restore: session check failed: $e');
        if (cachedUser != null) {
          try {
            user = SessionUser.fromJson(
              jsonDecode(cachedUser) as Map<String, dynamic>,
            );
            offlineSession = true;
          } catch (_) {
            user = null;
            _api.token = null;
            await _clearSession();
          }
        } else {
          user = null;
          _api.token = null;
          await SecureStore.delete(_tokenKey, legacyKey: _tokenKey);
        }
      }
    } catch (e) {
      debugPrint('[auth] restore: store failed: $e');
      user = null;
    } finally {
      loading = false;
      debugPrint('[auth] restore: done, loading=false');
      notifyListeners();
    }
  }

  /// POST /auth/login. When the server is unreachable, verifies the
  /// password against the device's offline credential store instead.
  /// Throws ApiException; check `requiresTwoFactor`.
  Future<void> signIn(String email, String password, {String? code}) async {
    dynamic res;
    try {
      res = await _api.post(
        '/auth/login',
        body: {
          'email': email,
          'password': password,
          if (code != null && code.isNotEmpty) 'code': code,
        },
      );
    } on ApiException catch (e) {
      if (e.status == 0 && (code == null || code.isEmpty)) {
        await _offlineSignIn(email, password);
        return;
      }
      rethrow;
    }
    _api.token = res['token'] as String;
    user = SessionUser.fromJson(res['user'] as Map<String, dynamic>);
    offlineSession = false;
    await SecureStore.write(_tokenKey, _api.token!);
    await _writeUser(res['user'] as Map<String, dynamic>);
    // Remember the address for biometric/offline prefill on the next visit.
    unawaited(
      SharedPreferences.getInstance().then(
        (p) => p.setString('dds_last_email', email),
      ),
    );
    await _accounts.save(
      email: email,
      password: password,
      user: res['user'] as Map<String, dynamic>,
      token: _api.token,
      has2fa: code != null && code.isNotEmpty,
    );
    // Offer biometric enrollment for offline sign-in on supported devices.
    try {
      if (await BiometricAuth.isAvailable) {
        await BiometricAuth.enroll(email);
      }
    } catch (e) {
      debugPrint('[auth] biometric enrollment failed: $e');
    }
    notifyListeners();
    onSessionReady?.call();
  }

  /// Verify credentials against the device-activated account store and
  /// restore the last session snapshot. Any verification failure is
  /// re-thrown as an ApiException so the sign-in screen renders it in the
  /// existing error box.
  Future<void> _offlineSignIn(String email, String password) async {
    try {
      final acct = await _accounts.verify(email, password);
      _api.token = acct.token; // may be stale — GETs fall back to cache
      user = SessionUser.fromJson(acct.user);
      offlineSession = true;
      if (acct.token != null) {
        await SecureStore.write(_tokenKey, acct.token!);
      }
      await _writeUser(acct.user);
      notifyListeners();
    } on OfflineAuthException catch (e) {
      debugPrint('[auth] offline sign-in failed: ${e.kind} — ${e.message}');
      throw ApiException(0, e.message);
    }
  }

  /// Sign in with device biometrics (fingerprint / Face ID). The OS prompt
  /// replaces the password check; the stored offline account snapshot is
  /// restored if the prompt succeeds. When the server is reachable the
  /// stored token is validated against `/auth/me` — a live session upgrades
  /// to a real online session, while an expired/absent token asks for the
  /// password instead of entering a session that would die on first sync.
  Future<void> signInWithBiometric(String email) async {
    OfflineAccount acct;
    try {
      final found = await BiometricAuth.authenticate(email);
      if (found == null) {
        throw ApiException(0, tr('Biometric sign-in failed or was cancelled.'));
      }
      acct = found;
    } on OfflineAuthException catch (e) {
      debugPrint('[auth] biometric sign-in failed: ${e.kind} — ${e.message}');
      throw ApiException(0, e.message);
    }

    if (await _serverReachable()) {
      if (acct.token == null) {
        throw ApiException(
          0,
          tr('Sign in with your password once to refresh this device.'),
        );
      }
      _api.token = acct.token;
      try {
        final res = await _api
            .get('/auth/me', useCache: false)
            .timeout(const Duration(seconds: 10));
        user = SessionUser.fromJson(res['user'] as Map<String, dynamic>);
        offlineSession = false;
        await SecureStore.write(_tokenKey, acct.token!);
        await _writeUser(res['user'] as Map<String, dynamic>);
        await _accounts.updateSession(
          email,
          user: res['user'] as Map<String, dynamic>,
          token: acct.token,
        );
        unawaited(
          SharedPreferences.getInstance().then(
            (p) => p.setString('dds_last_email', email),
          ),
        );
        notifyListeners();
        onSessionReady?.call();
        return;
      } on ApiException catch (e) {
        if (e.status == 401) {
          _api.token = null;
          throw ApiException(
            0,
            tr('Saved session expired — sign in with your password.'),
          );
        }
        rethrow;
      }
    }

    _api.token = acct.token; // may be stale — GETs fall back to cache
    user = SessionUser.fromJson(acct.user);
    offlineSession = true;
    if (acct.token != null) {
      await SecureStore.write(_tokenKey, acct.token!);
    }
    await _writeUser(acct.user);
    notifyListeners();
  }

  /// True when `/health` answers — decides whether biometric unlock can be
  /// upgraded to a live session or must stay an offline one.
  Future<bool> _serverReachable() async {
    try {
      await _api
          .get('/health', useCache: false)
          .timeout(const Duration(seconds: 6));
      return true;
    } catch (_) {
      return false;
    }
  }

  /// [wipeOffline] removes this account's offline credential, user snapshot,
  /// read cache and cached images — the "remove offline access" sign-out.
  /// The default keeps offline access (device-bound, like cached domain
  /// logons) so the account can still sign in without a connection.
  Future<void> signOut({bool wipeOffline = false}) async {
    final email = user?.email;
    try {
      await _api.post('/auth/logout');
    } catch (_) {
      /* best effort — clear locally regardless */
    }
    _api.token = null;
    user = null;
    offlineSession = false;
    await _clearSession();
    if (email != null) {
      if (wipeOffline) {
        await _accounts.remove(email);
        await _purgeReadCache(await SharedPreferences.getInstance());
        await ImageCacheStore().clear();
      } else {
        await _accounts.clearToken(email);
      }
    }
    notifyListeners();
  }

  Future<void> _purgeReadCache(SharedPreferences prefs) async {
    for (final key in prefs.getKeys()) {
      if (key.startsWith('cache:') ||
          key.startsWith('cache_ts:') ||
          key == 'dds_last_live_get') {
        await prefs.remove(key);
      }
    }
  }

  /// Server-side session expiry hook — wired to ApiClient.onUnauthorized.
  void handleUnauthorized() {
    if (user == null) return;
    _api.token = null;
    user = null;
    offlineSession = false;
    _clearSession();
    notifyListeners();
  }

  Future<void> _writeUser(Map<String, dynamic> u) async {
    await SecureStore.write(_userKey, jsonEncode(u));
    // Drop any plaintext copy left by older builds.
    (await SharedPreferences.getInstance()).remove(_userKey);
  }

  Future<void> _clearSession() async {
    await SecureStore.delete(_tokenKey, legacyKey: _tokenKey);
    await SecureStore.delete(_userKey, legacyKey: _userKey);
  }
}
