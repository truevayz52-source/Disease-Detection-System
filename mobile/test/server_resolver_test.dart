import 'package:dds_mobile/data/server_resolver.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('ServerResolver.normalize', () {
    test('accepts a bare host:port and appends /api', () {
      expect(
        ServerResolver.normalize('192.168.1.10:4001'),
        'http://192.168.1.10:4001/api',
      );
    });

    test('keeps a fully qualified URL', () {
      expect(
        ServerResolver.normalize('http://10.0.2.2:4001/api'),
        'http://10.0.2.2:4001/api',
      );
    });

    test('keeps an explicit scheme and adds /api to a bare domain', () {
      expect(
        ServerResolver.normalize('https://api.example.gov.zw'),
        'https://api.example.gov.zw/api',
      );
    });

    test('strips trailing slashes', () {
      expect(
        ServerResolver.normalize('http://192.168.1.10:4001/api/'),
        'http://192.168.1.10:4001/api',
      );
    });

    test('rejects empty and hostless input', () {
      expect(ServerResolver.normalize(''), isNull);
      expect(ServerResolver.normalize('   '), isNull);
      expect(ServerResolver.normalize('http://'), isNull);
    });
  });

  group('ServerResolver candidates', () {
    test('saved override is tried first', () async {
      SharedPreferences.setMockInitialValues({
        'dds_api_url': 'http://192.168.8.5:4001/api',
      });
      final cands = await ServerResolver.candidates();
      expect(cands.first.$1, 'http://192.168.8.5:4001/api');
      expect(cands.first.$2, ServerSource.saved);
    });

    test('platform default is always the last candidate', () async {
      SharedPreferences.setMockInitialValues({});
      final cands = await ServerResolver.candidates();
      expect(cands.last.$2, ServerSource.platformDefault);
      expect(cands.last.$1, ServerResolver.platformDefault);
    });

    test('deduplicates identical URLs, keeping the earlier source', () async {
      SharedPreferences.setMockInitialValues({
        'dds_api_url': ServerResolver.platformDefault,
      });
      final cands = await ServerResolver.candidates();
      final urls = cands.map((c) => c.$1).toList();
      expect(urls.toSet().length, urls.length);
    });
  });

  group('ServerResolver override persistence', () {
    test('save → savedOverride → clearOverride round-trip', () async {
      SharedPreferences.setMockInitialValues({});
      await ServerResolver.saveOverride('http://192.168.1.20:4001/api');
      expect(
        await ServerResolver.savedOverride(),
        'http://192.168.1.20:4001/api',
      );
      expect(
        await ServerResolver.lastGood(),
        'http://192.168.1.20:4001/api',
      );
      await ServerResolver.clearOverride();
      expect(await ServerResolver.savedOverride(), isNull);
    });

    test('invalidateLastGood only clears a matching URL', () async {
      SharedPreferences.setMockInitialValues({
        'dds_api_url_last_good': 'http://192.168.1.20:4001/api',
      });
      await ServerResolver.invalidateLastGood('http://other:4001/api');
      expect(
        await ServerResolver.lastGood(),
        'http://192.168.1.20:4001/api',
      );
      await ServerResolver.invalidateLastGood('http://192.168.1.20:4001/api');
      expect(await ServerResolver.lastGood(), isNull);
    });
  });
}
