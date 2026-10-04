import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

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
  /// Override at build time:
  ///   flutter run --dart-define DDS_API_URL=http://192.168.1.10:4000/api
  ///
  /// Defaults: Android emulator reaches the host machine via 10.0.2.2;
  /// every other platform uses localhost.
  static String get baseUrl {
    const defined = String.fromEnvironment('DDS_API_URL');
    if (defined.isNotEmpty) return defined;
    if (!kIsWeb && Platform.isAndroid) return 'http://10.0.2.2:4000/api';
    return 'http://localhost:4000/api';
  }

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

  ApiClient() {
    SharedPreferences.getInstance().then((p) {
      final ts = p.getString('dds_last_live_get');
      if (ts != null) lastLiveFetchAt = DateTime.tryParse(ts);
    });
  }

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
      res = await switch (method) {
        'POST' => http.post(uri, headers: headers, body: encoded),
        'PATCH' => http.patch(uri, headers: headers, body: encoded),
        'PUT' => http.put(uri, headers: headers, body: encoded),
        'DELETE' => http.delete(uri, headers: headers),
        _ => http.get(uri, headers: headers),
      }.timeout(const Duration(seconds: 15));
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
      streamed = await req.send().timeout(const Duration(seconds: 30));
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
