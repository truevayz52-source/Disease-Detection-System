import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

void _log(String msg) => debugPrint('[server_resolver] $msg');

/// How a server address was found — surfaced in the settings sheet so users
/// can see whether they're on a saved address, a discovered LAN host, etc.
enum ServerSource {
  saved,
  dartDefine,
  publicUrl,
  lastGood,
  platformDefault,
  beacon,
  scan,
}

/// Locates the DDS API across networks. Candidates are probed in priority
/// order and the first reachable wins:
///
///   1. User-saved override (`dds_api_url` — set from the settings sheet)
///   2. `DDS_API_URL` build-time dart-define
///   3. `DDS_PUBLIC_URL` build-time dart-define (fixed public domain)
///   4. Last-good URL (persisted after each successful resolve)
///   5. Platform default — 10.0.2.2 on the Android emulator, localhost else
///
/// [resolve] is fast: static candidates only. When none answer, callers can
/// run discovery — a UDP beacon listener (the server broadcasts its address
/// on port 40401) and a /24 subnet scan — via [discoverOnLan].
class ServerResolver {
  static const beaconPort = 40401;
  static const defaultPort = 4001;
  static const _savedKey = 'dds_api_url';
  static const _lastGoodKey = 'dds_api_url_last_good';
  static const _probeTimeout = Duration(seconds: 2);

  /// Normalize user/built input to `scheme://host[:port]/api`.
  /// Accepts bare hosts/IPs (http assumed) and URLs without the /api suffix.
  static String? normalize(String raw) {
    var s = raw.trim();
    if (s.isEmpty) return null;
    if (!s.startsWith('http://') && !s.startsWith('https://')) {
      s = 'http://$s';
    }
    final uri = Uri.tryParse(s);
    if (uri == null || uri.host.isEmpty) return null;
    var path = uri.path.replaceAll(RegExp(r'/+$'), '');
    if (!path.endsWith('/api')) path = '$path/api';
    return Uri(
      scheme: uri.scheme,
      host: uri.host,
      port: uri.hasPort ? uri.port : null,
      path: path,
    ).toString();
  }

  /// The platform default — Android emulator reaches the dev host through
  /// 10.0.2.2; everything else uses localhost.
  static String get platformDefault {
    if (!kIsWeb && Platform.isAndroid) {
      return 'http://10.0.2.2:$defaultPort/api';
    }
    return 'http://localhost:$defaultPort/api';
  }

  /// GET `{baseUrl}/health`; true only when the body identifies this API —
  /// guards the subnet scan against unrelated services on the same port.
  static Future<bool> probe(
    String baseUrl, {
    Duration timeout = _probeTimeout,
  }) async {
    final url = normalize(baseUrl);
    if (url == null) return false;
    try {
      final res = await http
          .get(
            Uri.parse('$url/health'),
            headers: const {'accept': 'application/json'},
          )
          .timeout(timeout);
      if (res.statusCode != 200) return false;
      final body = jsonDecode(res.body);
      return body is Map &&
          body['status'] == 'ok' &&
          body['service'].toString().contains('Disease Detection');
    } catch (_) {
      return false;
    }
  }

  /// Ordered candidate URLs for the current device configuration.
  static Future<List<(String, ServerSource)>> candidates() async {
    final prefs = await SharedPreferences.getInstance();
    final list = <(String, ServerSource)>[];
    void add(String? raw, ServerSource src) {
      final n = raw == null ? null : normalize(raw);
      if (n != null && !list.any((c) => c.$1 == n)) list.add((n, src));
    }

    add(prefs.getString(_savedKey), ServerSource.saved);
    add(const String.fromEnvironment('DDS_API_URL'), ServerSource.dartDefine);
    add(const String.fromEnvironment('DDS_PUBLIC_URL'), ServerSource.publicUrl);
    add(prefs.getString(_lastGoodKey), ServerSource.lastGood);
    add(platformDefault, ServerSource.platformDefault);
    return list;
  }

  /// Fast resolve — probes the static candidates and returns the first that
  /// answers. When nothing answers, returns the first candidate anyway so
  /// callers have a concrete URL to display in error messages. Discovery
  /// (beacon/scan) is a separate, slower step driven by the UI or by
  /// repeated reachability failures.
  static Future<String> resolve() async {
    final cands = await candidates();
    for (final (url, src) in cands) {
      _log('probing $url ($src)');
      if (await probe(url)) {
        await _markLastGood(url);
        _log('resolved $url via $src');
        return url;
      }
    }
    _log('no candidate reachable — keeping ${cands.first.$1}');
    return cands.first.$1;
  }

  /// LAN discovery — listens for the server's UDP beacon (5s window) and
  /// scans the local /24 on [port] in parallel. Returns verified base URLs.
  static Future<List<String>> discoverOnLan({int port = defaultPort}) async {
    final results = await Future.wait([
      _listenForBeacon(),
      _scanSubnet(port: port),
    ]);
    final found = <String>{};
    for (final url in results.expand((r) => r)) {
      found.add(url);
    }
    return found.toList();
  }

  /// Listen for `DDS:<ip>:<port>` broadcasts for [window]. iOS blocks
  /// broadcast receive in practice — returns null there; callers should rely
  /// on the subnet scan on iOS.
  static Future<List<String>> _listenForBeacon({
    Duration window = const Duration(seconds: 5),
  }) async {
    if (kIsWeb) return const [];
    RawDatagramSocket? sock;
    try {
      sock = await RawDatagramSocket.bind(
        InternetAddress.anyIPv4,
        beaconPort,
        reuseAddress: true,
      );
      final found = <String>{};
      final done = Completer<void>();
      final timer = Timer(window, () {
        if (!done.isCompleted) done.complete();
      });
      final sub = sock.listen((event) {
        if (event != RawSocketEvent.read) return;
        final dg = sock!.receive();
        if (dg == null) return;
        final msg = utf8.decode(dg.data, allowMalformed: true).trim();
        final m = RegExp(r'^DDS:([0-9.]+):(\d+)$').firstMatch(msg);
        if (m != null) {
          found.add('http://${m.group(1)}:${m.group(2)}/api');
        }
      });
      await done.future;
      timer.cancel();
      await sub.cancel();
      sock.close();
      // Verify — a stray broadcaster on the port shouldn't win.
      final verified = <String>[];
      for (final url in found) {
        if (await probe(url)) verified.add(url);
      }
      _log('beacon: ${verified.isEmpty ? 'none' : verified.join(', ')}');
      return verified;
    } catch (e) {
      _log('beacon listen failed: $e');
      try {
        sock?.close();
      } catch (_) {}
      return const [];
    }
  }

  /// Probe every host on the local /24(s) — two-phase: TCP connect filters
  /// to live hosts quickly, then /health confirms it's really this API.
  /// Stops scanning a prefix once a server is found (field devices, battery).
  static Future<List<String>> _scanSubnet({
    int port = defaultPort,
    Duration connectTimeout = const Duration(milliseconds: 300),
  }) async {
    if (kIsWeb) return const [];
    List<NetworkInterface> nets;
    try {
      nets = await NetworkInterface.list(
        type: InternetAddressType.IPv4,
        includeLinkLocal: false,
      );
    } catch (e) {
      _log('interface list failed: $e');
      return const [];
    }
    final prefixes = <String>{};
    for (final ni in nets) {
      for (final addr in ni.addresses) {
        if (addr.isLoopback) continue;
        final parts = addr.address.split('.');
        if (parts.length == 4) prefixes.add(parts.take(3).join('.'));
      }
    }
    if (prefixes.isEmpty) return const [];

    const batch = 48;
    for (final prefix in prefixes) {
      for (var i = 1; i < 255; i += batch) {
        final futures = <Future<String?>>[];
        for (var j = i; j < i + batch && j < 255; j++) {
          futures.add(_probeHost('$prefix.$j', port, connectTimeout));
        }
        final hits = (await Future.wait(futures)).whereType<String>().toList();
        if (hits.isNotEmpty) {
          _log('scan found $hits');
          return hits;
        }
      }
    }
    _log('scan found nothing');
    return const [];
  }

  /// TCP-connect then /health-probe a single host; returns its base URL or
  /// null. Failures are swallowed — this runs 254× during a scan.
  static Future<String?> _probeHost(
    String host,
    int port,
    Duration connectTimeout,
  ) async {
    try {
      final sock = await Socket.connect(host, port, timeout: connectTimeout);
      await sock.close();
    } catch (_) {
      return null;
    }
    final url = 'http://$host:$port/api';
    return await probe(url, timeout: const Duration(seconds: 3)) ? url : null;
  }

  // --- persistence ---

  static Future<String?> savedOverride() async =>
      (await SharedPreferences.getInstance()).getString(_savedKey);

  static Future<void> saveOverride(String url) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_savedKey, url);
    await _markLastGood(url);
  }

  static Future<void> clearOverride() async =>
      (await SharedPreferences.getInstance()).remove(_savedKey);

  static Future<String?> lastGood() async =>
      (await SharedPreferences.getInstance()).getString(_lastGoodKey);

  static Future<void> _markLastGood(String url) async =>
      (await SharedPreferences.getInstance()).setString(_lastGoodKey, url);

  /// Forget the last-good pointer — called when requests keep failing so the
  /// next resolve() tries the full candidate list again.
  static Future<void> invalidateLastGood(String url) async {
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getString(_lastGoodKey) == url) {
      await prefs.remove(_lastGoodKey);
    }
  }
}
