import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:dds_mobile/data/local_store.dart';
import 'package:dds_mobile/data/read_cache.dart';

// LocalStore is never initialized here — the in-memory fallback stands in
// for the encrypted Hive box.
void main() {
  const uri = 'http://localhost:4001/api/notifications';

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await LocalStore.clear('read_cache');
  });

  test('put/get/fetchedAt round-trip a response body', () async {
    final cache = ReadCache();
    expect(await cache.get(uri), isNull);

    await cache.put(uri, '{"items":[1,2]}');
    expect(await cache.get(uri), '{"items":[1,2]}');
    expect(await cache.getJson(uri), {
      'items': [1, 2],
    });
    expect(await cache.fetchedAt(uri), isNotNull);
  });

  test('legacy SharedPreferences entries migrate into the box once', () async {
    SharedPreferences.setMockInitialValues({
      'cache:$uri': '{"legacy":true}',
      'cache_ts:$uri': '2026-01-02T03:04:05.000Z',
    });

    final cache = ReadCache();
    expect(await cache.get(uri), '{"legacy":true}');
    // fetchedAt survives the migration.
    expect(
      await cache.fetchedAt(uri),
      DateTime.parse('2026-01-02T03:04:05.000Z'),
    );
    // Legacy keys are gone; the box now owns the entry.
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getString('cache:$uri'), isNull);
    expect(prefs.getString('cache_ts:$uri'), isNull);
    final stored = await LocalStore.get('read_cache', uri);
    expect(stored?['body'], '{"legacy":true}');
  });

  test('clear drops box entries and any legacy prefs leftovers', () async {
    SharedPreferences.setMockInitialValues({
      'cache:$uri': 'x',
      'cache_ts:$uri': '2026-01-01T00:00:00.000Z',
      'unrelated': 'keep',
    });
    final cache = ReadCache();
    await cache.put('http://localhost:4001/api/alerts', 'y');

    await cache.clear();

    expect(await cache.get(uri), isNull);
    expect(await cache.get('http://localhost:4001/api/alerts'), isNull);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getKeys().where((k) => k.startsWith('cache')), isEmpty);
    expect(prefs.getString('unrelated'), 'keep');
  });
}
