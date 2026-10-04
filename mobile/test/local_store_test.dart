import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:dds_mobile/data/draft_store.dart';
import 'package:dds_mobile/data/local_store.dart';

// LocalStore is never initialized here — without plugins it uses the
// in-memory fallback, which is exactly what these tests exercise.
void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await LocalStore.clear('sync_queue');
    await LocalStore.clear('offline_cases');
    await LocalStore.clear('drafts');
  });

  test('queue replays items in FIFO order', () async {
    final queue = OfflineQueue();
    final a = await queue.enqueueNotification({
      'patient': {'fullName': 'A'},
    });
    final b = await queue.enqueueNotification({
      'patient': {'fullName': 'B'},
    });
    await queue.enqueueImage('n1', '/tmp/x.png');

    final items = await queue.entries();
    expect(items.length, 3);
    expect(items[0].id, a.id);
    expect(items[1].id, b.id);
    expect(items[0].data['patient']['fullName'], 'A');
    expect(items[1].data['patient']['fullName'], 'B');
    expect(items[2].type, 'image');
    expect(await queue.count(), 3);

    await queue.remove(a.id);
    final rest = await queue.entries();
    expect(rest.length, 2);
    expect(rest.first.id, b.id);
  });

  test('enqueueNotification records a pending offline case', () async {
    final queue = OfflineQueue();
    final item = await queue.enqueueNotification({
      'patient': {'fullName': 'Jane Doe'},
    });

    final reports = await OfflineCaseStore.localReports();
    expect(reports, hasLength(1));
    expect(reports.single['local_id'], item.id);
    expect(reports.single['sync_status'], 'PENDING');

    await OfflineCaseStore.markStatus(item.id, 'SYNCED');
    final updated = await OfflineCaseStore.localReports();
    expect(updated.single['sync_status'], 'SYNCED');
  });

  test('legacy SharedPreferences queue entries migrate once', () async {
    SharedPreferences.setMockInitialValues({
      'dds_offline_queue': [
        jsonEncode({
          'id': 'legacy-1',
          'type': 'notification',
          'data': {
            'patient': {'fullName': 'Old'},
          },
          'queuedAt': DateTime.now().toIso8601String(),
        }),
      ],
    });

    final items = await OfflineQueue().entries();
    expect(
      items.any((i) => i.id == 'legacy-1'),
      isTrue,
      reason: 'legacy entry should be imported into the Hive-backed queue',
    );
  });

  test('draft round-trips and clears', () async {
    final drafts = DraftStore();
    expect(await drafts.loadDraft(), isNull);

    await drafts.saveDraft({
      'patient': {'fullName': 'Draft Patient'},
    });
    expect((await drafts.loadDraft())?['patient']['fullName'], 'Draft Patient');

    await drafts.clearDraft();
    expect(await drafts.loadDraft(), isNull);
  });
}
