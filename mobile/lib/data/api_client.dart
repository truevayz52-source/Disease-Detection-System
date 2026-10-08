import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'server_resolver.dart';
import '../l10n/app_localizations.dart';

/// Mirrors client/src/lib/api.ts — attaches the JWT, normalizes errors and
/// surfaces ApiException for non-2xx responses.
class ApiException implements Exception {
  ApiException(this.status, this.message, [this.data]);

  final int status;
  final String message;
  final dynamic data;

  bool get requiresTwoFactor =>
      data is Map && data['requiresTwoFactor'] == true;

  @override
  String toString() => message;
}

class ApiClient {
  /// Base URL of the DDS REST API (no trailing slash).
  ///
  /// Resolution order (see ServerResolver): user-saved override →
  /// `DDS_API_URL` / `DDS_PUBLIC_URL` build-time defines → last-good URL →
  /// platform default (10.0.2.2 on the Android emulator, localhost else).
  /// `init()` probes the candidates and adopts the first reachable one;
  /// the settings sheet can change it at runtime via [setBaseUrl].
  ApiClient()
    : _baseUrl =
          ServerResolver.normalize(
            const String.fromEnvironment('DDS_API_URL'),
          ) ??
          ServerResolver.platformDefault {
    SharedPreferences.getInstance().then((p) {
      final ts = p.getString('dds_last_live_get');
      if (ts != null) lastLiveFetchAt = DateTime.tryParse(ts);
    });
  }

  String _baseUrl;
  String get baseUrl => _baseUrl;

  /// Completes once [init] has probed static candidates — AuthRepository's
  /// restore awaits it so a cold start targets a verified server.
  Future<void>? get ready => _init;
  Future<void>? _init;
  bool _resolving = false;

  /// True while a low-bandwidth link is active (cellular / no wifi). Fed by
  /// SyncService's connectivity listener; doubles request timeouts.
  bool networkSlow = false;

  /// Bearer token for the active session; null when signed out.
  String? token;

  /// Called on a 401 outside of login so the app can drop back to sign-in.
  VoidCallback? onUnauthorized;

  /// Called with the server's observed reachability: `true` when an HTTP
  /// response arrives (any status), `false` on socket/timeout failure.
  /// SyncService uses this instead of raw device connectivity.
  void Function(bool reachable)? onReachability;

  /// True when the last response was served from the offline read cache
  /// rather than the network — lets auth mark the session as offline.
  bool lastFromCache = false;

  /// Timestamp of the last successful live GET — shown as "data as of …" in
  /// the offline banner. Hydrated from prefs so it survives restarts.
  DateTime? lastLiveFetchAt;

  /// Probe static candidates once at startup and adopt the first reachable
  /// URL. Discovery (beacon/subnet scan) stays opt-in — it's too slow for
  /// the cold-start path.
  Future<void> init() => _init ??= _resolve();

  /// Persist a user-entered server address and start using it immediately.
  Future<bool> setBaseUrl(String raw) async {
    final url = ServerResolver.normalize(raw);
    if (url == null) return false;
    _baseUrl = url;
    await ServerResolver.saveOverride(url);
    return true;
  }

  /// Drop the saved override and re-resolve from the remaining candidates.
  Future<String> resetBaseUrl() async {
    await ServerResolver.clearOverride();
    return _resolve();
  }

  Future<String> _resolve() async {
    if (_resolving) return _baseUrl;
    _resolving = true;
    try {
      _baseUrl = await ServerResolver.resolve();
      return _baseUrl;
    } finally {
      _resolving = false;
    }
  }

  /// After repeated status-0 failures, drop the stale last-good pointer and
  /// re-resolve — but never override an address the user set explicitly.
  void _maybeReresolve() {
    unawaited(() async {
      await ServerResolver.invalidateLastGood(_baseUrl);
      if (await ServerResolver.savedOverride() == _baseUrl) return;
      await _resolve();
    }());
  }

  Duration get _requestTimeout =>
      networkSlow ? const Duration(seconds: 30) : const Duration(seconds: 15);
  Duration get _uploadTimeout =>
      networkSlow ? const Duration(seconds: 60) : const Duration(seconds: 30);

  Map<String, String> get _headers => {
    'accept': 'application/json',
    if (token != null) 'authorization': 'Bearer $token',
  };

  /// Authenticated URL for image/file endpoints (mirrors authedFileUrl).
  String fileUrl(String imageId) =>
      '$baseUrl/images/$imageId/file?token=${Uri.encodeComponent(token ?? '')}';

  Future<dynamic> request(
    String method,
    String path, {
    Object? body,
    Map<String, String>? query,
    bool useCache = true,
  }) async {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final headers = {..._headers};
    Object? encoded;
    if (body != null) {
      headers['content-type'] = 'application/json';
      encoded = jsonEncode(body);
    }

    http.Response res;
    try {
      res = await _send(method, uri, headers, encoded);
      onReachability?.call(true);
      lastFromCache = false;
    } on SocketException {
      onReachability?.call(false);
      return _offlineOrThrow(method, uri, useCache: useCache);
    } on http.ClientException {
      onReachability?.call(false);
      return _offlineOrThrow(method, uri, useCache: useCache);
    } on TimeoutException {
      onReachability?.call(false);
      return _offlineOrThrow(method, uri, useCache: useCache);
    }

    if (res.statusCode == 401 && token != null && path != '/auth/login') {
      onUnauthorized?.call();
      throw ApiException(401, tr('Session expired'));
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      String message = res.reasonPhrase ?? tr('Request failed');
      dynamic data;
      try {
        data = jsonDecode(res.body);
        if (data is Map && data['error'] != null) {
          message = data['error'].toString();
        }
      } catch (_) {
        /* non-json body */
      }
      throw ApiException(res.statusCode, message, data);
    }
    final ct = res.headers['content-type'] ?? '';
    if (method == 'GET' && ct.contains('json') && useCache) {
      // Cache successful reads so the app can render last-known data offline.
      lastLiveFetchAt = DateTime.now();
      final ts = lastLiveFetchAt!.toIso8601String();
      SharedPreferences.getInstance().then((p) {
        p.setString('cache:${uri.toString()}', res.body);
        p.setString('cache_ts:${uri.toString()}', ts);
        p.setString('dds_last_live_get', ts);
      });
    }
    if (!ct.contains('json')) return res.body;
    return jsonDecode(res.body);
  }

  /// Single network attempt, with one backoff retry on connection failures
  /// for idempotent requests (GETs and the login check — login is safe to
  /// replay: worst case the server issues a second JWT we discard).
  /// Mutating POST/PATCH never auto-retry — the offline queue owns replay.
  Future<http.Response> _send(
    String method,
    Uri uri,
    Map<String, String> headers,
    Object? body,
  ) async {
    final idempotent = method == 'GET' || uri.path.endsWith('/auth/login');
    const attempts = 2;
    for (var i = 0; i < (idempotent ? attempts : 1); i++) {
      try {
        if (i > 0) {
          await Future<void>.delayed(const Duration(milliseconds: 800));
        }
        return await switch (method) {
          'POST' => http.post(uri, headers: headers, body: body),
          'PATCH' => http.patch(uri, headers: headers, body: body),
          'PUT' => http.put(uri, headers: headers, body: body),
          'DELETE' => http.delete(uri, headers: headers),
          _ => http.get(uri, headers: headers),
        }.timeout(i == 0 ? _requestTimeout : _requestTimeout * 2);
      } on TimeoutException {
        if (i + 1 == attempts || !idempotent) rethrow;
      } on SocketException {
        if (i + 1 == attempts || !idempotent) {
          _maybeReresolve();
          rethrow;
        }
      } on http.ClientException {
        if (i + 1 == attempts || !idempotent) {
          _maybeReresolve();
          rethrow;
        }
      }
    }
    throw TimeoutException('request timed out'); // unreachable
  }

  /// When the network is unreachable, serve the cached GET response if we
  /// have one; otherwise surface a connection error (status 0).
  Future<dynamic> _offlineOrThrow(
    String method,
    Uri uri, {
    bool useCache = true,
  }) async {
    if (method == 'GET' && useCache) {
      final cached = (await SharedPreferences.getInstance()).getString(
        'cache:${uri.toString()}',
      );
      if (cached != null) {
        lastFromCache = true;
        return jsonDecode(cached);
      }
    }
    throw ApiException(
      0,
      tr('Cannot reach the DDS server. Check your connection.'),
    );
  }

  Future<dynamic> get(
    String path, {
    Map<String, String>? query,
    bool useCache = true,
  }) => request('GET', path, query: query, useCache: useCache);
  Future<dynamic> post(String path, {Object? body}) =>
      request('POST', path, body: body);
  Future<dynamic> patch(String path, {Object? body}) =>
      request('PATCH', path, body: body);

  /// Multipart upload for tele-pathology images (POST /notifications/:id/images).
  Future<dynamic> uploadImage(
    String notificationId,
    String filePath, {
    String field = 'file',
  }) async {
    final uri = Uri.parse('$baseUrl/notifications/$notificationId/images');
    final req = http.MultipartRequest('POST', uri)
      ..headers.addAll(_headers)
      ..files.add(await http.MultipartFile.fromPath(field, filePath));
    http.StreamedResponse streamed;
    try {
      streamed = await req.send().timeout(_uploadTimeout);
      onReachability?.call(true);
    } on SocketException {
      onReachability?.call(false);
      throw ApiException(
        0,
        tr('Cannot reach the DDS server. Check your connection.'),
      );
    } on http.ClientException {
      onReachability?.call(false);
      throw ApiException(
        0,
        tr('Cannot reach the DDS server. Check your connection.'),
      );
    } on TimeoutException {
      onReachability?.call(false);
      throw ApiException(0, tr('Upload timed out. Check your connection.'));
    }
    final res = await http.Response.fromStream(streamed);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      String message = res.reasonPhrase ?? tr('Upload failed');
      try {
        final data = jsonDecode(res.body);
        if (data is Map && data['error'] != null) {
          message = data['error'].toString();
        }
      } catch (_) {
        /* non-json body */
      }
      throw ApiException(res.statusCode, message);
    }
    return jsonDecode(res.body);
  }
}
