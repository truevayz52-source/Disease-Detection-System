import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:dds_mobile/data/api_client.dart';
import 'package:dds_mobile/data/dds_repository.dart';
import 'package:dds_mobile/data/draft_store.dart';
import 'package:dds_mobile/data/entity_shadow.dart';
import 'package:dds_mobile/data/local_store.dart';
import 'package:dds_mobile/data/sync_engine.dart';
import 'package:dds_mobile/data/sync_ops.dart';

/// Records every outgoing call; a handler decides the canned response.
class FakeApi extends ApiClient {
  final calls = <String>[];
  Object? Function(String method, String path, Object? body)? onRequest;

  @override
  Future<dynamic> request(
    String method,
    String path, {
    Object? body,
    Map<String, String>? query,
    bool useCache = true,
  }) async {
    calls.add('$method $path');
    final result = onRequest?.call(method, path, body);
    if (result is Exception) throw result;
    return result ?? <String, dynamic>{};
  }

  @override
  Future<dynamic> postMultipart(
    String path,
    String filePath, {
    String field = 'file',
    Map<String, String> fields = const {},
  }) async => request('POST', path, body: {'filePath': filePath});
}

QueuedOp httpOp(
  String id, {
  String method = 'PATCH',
  String path = '/notifications/n1',
  DateTime? at,
}) => QueuedOp.http(
  id: id,
  method: method,
  path: path,
  entityType: 'death_notification',
  entityId: 'n1',
  queuedAt: at ?? DateTime(2026, 1, 1),
);

void main() {
  late FakeApi api;
  late OfflineQueue queue;
  late EntityShadowStore shadow;
  late SyncEngine engine;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    for (final box in ['sync_queue', 'offline_cases', 'entity_shadow']) {
      await LocalStore.clear(box);
    }
    api = FakeApi();
    queue = OfflineQueue();
    shadow = EntityShadowStore();
    engine = SyncEngine(api, DdsRepository(api), queue, shadow);
  });

  test('flush replays non-notification ops in FIFO order', () async {
    await queue.enqueueOp(httpOp('first', path: '/a'));
    await queue.enqueueOp(httpOp('second', path: '/b'));

    final outcome = await engine.flush();

    expect(api.calls, ['PATCH /a', 'PATCH /b']);
    expect(outcome.synced, 2);
    expect(await queue.count(), 0);
  });

  test('notification creates batch through /offline/sync in chunks of 20', () async {
    final posted = <List<dynamic>>[];
    api.onRequest = (method, path, body) {
      final items = (body as Map)['items'] as List;
      posted.add(items);
      return {
        'results': [for (final i in items) {'id': i['id'], 'status': 'synced'}],
      };
    };
    for (var i = 0; i < 25; i++) {
      await queue.enqueueOp(
        QueuedOp.notification(
          id: 'n$i',
          payload: {'i': i},
          queuedAt: DateTime(2026, 1, 1),
        ),
      );
    }

    final outcome = await engine.flush();

    expect(posted.length, 2);
    expect(posted[0].length, 20);
    expect(posted[1].length, 5);
    expect(outcome.synced, 25);
    expect(await queue.count(), 0);
  });

  test('409 marks the case CONFLICT, drops the op and the overlay', () async {
    final op = httpOp('op-409');
    await queue.enqueueOp(op);
    await shadow.applyOverlay(op, {'status': 'certified'});
    api.onRequest = (m, p, b) => ApiException(409, 'server copy won');

    final outcome = await engine.flush();

    expect(outcome.conflicts, 1);
    expect(outcome.synced, 0);
    expect(await queue.count(), 0);
    final reports = await OfflineCaseStore.localReports();
    expect(reports.single['sync_status'], 'CONFLICT');
    final eff = await shadow.effective('death_notification', 'n1');
    expect(eff?['syncPending'], isNull);
  });

  test('other 4xx marks the case REJECTED', () async {
    await queue.enqueueOp(httpOp('op-422'));
    api.onRequest = (m, p, b) => ApiException(422, 'validation failed');

    final outcome = await engine.flush();

    expect(outcome.rejected, 1);
    final reports = await OfflineCaseStore.localReports();
    expect(reports.single['sync_status'], 'REJECTED');
  });

  test('status 0 halts the pass, bumps attempts, keeps later ops', () async {
    await queue.enqueueOp(httpOp('op-a', path: '/a'));
    await queue.enqueueOp(httpOp('op-b', path: '/b'));
    api.onRequest = (m, p, b) => ApiException(0, 'socket unreachable');

    final outcome = await engine.flush();

    expect(outcome.halted, isTrue);
    expect(api.calls, ['PATCH /a']); // halted — /b never attempted
    final a = await queue.get('op-a');
    expect(a?.attempts, 1);
    expect(a?.lastError, 'socket unreachable');
    expect(await queue.get('op-b'), isNotNull);
    expect(outcome.remaining, 2);
  });

  test('401 halts the pass with needsReauth and keeps the queue', () async {
    await queue.enqueueOp(httpOp('op-auth'));
    api.onRequest = (m, p, b) => ApiException(401, 'Session expired');

    final outcome = await engine.flush();

    expect(outcome.needsReauth, isTrue);
    expect(outcome.halted, isTrue);
    expect(await queue.get('op-auth'), isNotNull);
  });

  test('wire body injects clientUpdatedAt for server-side LWW', () async {
    final at = DateTime(2026, 3, 5, 10, 30);
    await queue.enqueueOp(httpOp('op-lww', at: at));
    Map? sent;
    api.onRequest = (m, p, b) {
      sent = b as Map;
      return {};
    };

    await engine.flush();

    expect(sent?['clientUpdatedAt'], at.toIso8601String());
  });
}
