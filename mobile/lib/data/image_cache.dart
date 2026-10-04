import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

/// On-device cache for tele-pathology images so reviewed specimens remain
/// viewable offline. Files live in `<docs>/imgcache/<imageId>` (app-private
/// storage) and are trimmed LRU-style past the size/file caps.
class ImageCacheStore {
  static const _maxFiles = 100;
  static const _maxBytes = 200 * 1024 * 1024;

  Future<Directory> _dir() async {
    final base = await getApplicationDocumentsDirectory();
    final d = Directory('${base.path}${Platform.pathSeparator}imgcache');
    if (!await d.exists()) await d.create(recursive: true);
    return d;
  }

  /// Returns the cached file for [imageId], or null when not cached.
  Future<File?> cachedFile(String imageId) async {
    try {
      final f = File('${(await _dir()).path}${Platform.pathSeparator}$imageId');
      return await f.exists() ? f : null;
    } catch (_) {
      return null;
    }
  }

  /// Fetch [url] and persist it under [imageId]. Returns null on any
  /// network/HTTP failure — the caller falls back to a placeholder.
  Future<File?> fetchAndCache(String imageId, String url) async {
    try {
      final res = await http
          .get(Uri.parse(url))
          .timeout(const Duration(seconds: 30));
      if (res.statusCode != 200 || res.bodyBytes.isEmpty) return null;
      final f = File('${(await _dir()).path}${Platform.pathSeparator}$imageId');
      await f.writeAsBytes(res.bodyBytes, flush: true);
      await _trim();
      return f;
    } catch (_) {
      return null;
    }
  }

  /// Delete every cached image — used by "remove offline access" sign-out.
  Future<void> clear() async {
    try {
      final d = await _dir();
      await for (final e in d.list()) {
        if (e is File) await e.delete();
      }
    } catch (_) {
      /* best effort */
    }
  }

  Future<void> _trim() async {
    final d = await _dir();
    final files = await d.list().where((e) => e is File).cast<File>().toList();
    var total = 0;
    for (final f in files) {
      total += await f.length();
    }
    if (files.length <= _maxFiles && total <= _maxBytes) return;
    files.sort((a, b) => a.lastModifiedSync().compareTo(b.lastModifiedSync()));
    for (final f in List.of(files)) {
      if (files.length <= _maxFiles && total <= _maxBytes) break;
      total -= await f.length();
      files.remove(f);
      await f.delete();
    }
  }
}
