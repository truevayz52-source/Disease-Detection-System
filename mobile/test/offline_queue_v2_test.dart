import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:dds_mobile/data/draft_store.dart';
import 'package:dds_mobile/data/local_store.dart';
import 'package:dds_mobile/data/sync_ops.dart';

// LocalStore is never initialized here — without plugins it uses the
// in-memory fallback, which is exactly what these tests exercise.
void main() {
  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    await LocalStore.clear('sync_queue');
    await LocalStore.clear('offline_cases');
  });

  test('v1 notification entries migrate to v2 ops on read', () async {
    SharedPreferences.setMockInitialValues({
      'dds_offline_queue': [
        jsonEncode({
          'id': 'v1-note',
          'type': 'notification',
          'data': {
            'patient': {'fullName': 'Legacy Patient'},
          },
          'queuedAt': '2026-01-01T00:00:00.000Z',
        }),
        jsonEncode({
          'id': 'v1-img',
          'type': 'image',
          'data': {'notificationId': 'n-1', 'filePath': '/tmp/x.png'},
          'queuedAt': '2026-01-01T00:01:00.000Z',
        }),
      ],
    });

    final items = await OfflineQueue().entries();
    expect(items, hasLength(2));

    expect(items[0].id, 'v1-note');
    expect(items[0].kind, 'notification');
    expect(items[0].body['patient']['fullName'], 'Legacy Patient');

    expect(items[1].kind, 'multipart');
    expect(items[1].path, '/notifications/n-1/images');
    expect(items[1].filePath, '/tmp/x.png');

    // Migration converges the store — the prefs key is removed.
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getStringList('dds_offline_queue'), isNull);
    // And the rewritten entries are v2 shaped in the box.
    final raw = await LocalStore.get('sync_queue', 'v1-note');
    expect(raw?['v'], 2);
  });

  test('enqueueOp keeps FIFO order; remove drops the entry', () async {
    final queue = OfflineQueue();
    final a = await queue.enqueueOp(
      QueuedOp.http(
        id: 'a',
        method: 'POST',
        path: '/alerts/a1/resolve',
        queuedAt: DateTime(2026, 1, 1),
      ),
    );
    await queue.enqueueOp(
      QueuedOp.http(
        id: 'b',
        method: 'PATCH',
        path: '/notifications/n2',
        body: {'clinicalSummary': 'x'},
        entityType: 'death_notification',
        entityId: 'n2',
        queuedAt: DateTime(2026, 1, 2),
      ),
    );

    final items = await queue.entries();
    expect(items.map((o) => o.id), ['a', 'b']);

    await queue.remove(a.id);
    expect((await queue.entries()).single.id, 'b');
    expect(await queue.count(), 1);
  });

  test('markAttempt bumps attempts and records lastError', () async {
    final queue = OfflineQueue();
    await queue.enqueueOp(
      QueuedOp.http(
        id: 'op-1',
        method: 'POST',
        path: '/x',
        queuedAt: DateTime.now(),
      ),
    );

    await queue.markAttempt('op-1', 'socket dead');
    await queue.markAttempt('op-1', 'still dead');

    final op = await queue.get('op-1');
    expect(op?.attempts, 2);
    expect(op?.lastError, 'still dead');
  });

  test('coalescing keeps only the newest pending op per coalesce key', () async {
    final queue = OfflineQueue();
    // PATCH ops default their coalesce key to `PATCH:<path>`.
    await queue.enqueueOp(
      QueuedOp.http(
        id: 'older',
        method: 'PATCH',
        path: '/notifications/n1',
        body: {'clinicalSummary': 'first draft'},
        entityType: 'death_notification',
        entityId: 'n1',
        queuedAt: DateTime(2026, 1, 1),
      ),
    );
    await queue.enqueueOp(
      QueuedOp.http(
        id: 'newer',
        method: 'PATCH',
        path: '/notifications/n1',
        body: {'clinicalSummary': 'second draft'},
        entityType: 'death_notification',
        entityId: 'n1',
        queuedAt: DateTime(2026, 1, 2),
      ),
    );

    final items = await queue.entries();
    expect(items, hasLength(1));
    expect(items.single.id, 'newer');
    expect(items.single.body['clinicalSummary'], 'second draft');
  });

  test('queued ops leave a PENDING offline_cases record', () async {
    await OfflineQueue().enqueueOp(
      QueuedOp.notification(
        id: 'note-1',
        payload: {
          'patient': {'fullName': 'Field Case'},
        },
        queuedAt: DateTime.now(),
      ),
    );

    final pending = await OfflineCaseStore.pending();
    expect(pending.single['local_id'], 'note-1');
    expect(pending.single['sync_status'], 'PENDING');
    expect(pending.single['kind'], 'notification');
  });
}
