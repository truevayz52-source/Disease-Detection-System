import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:dds_mobile/data/api_client.dart';
import 'package:dds_mobile/data/draft_store.dart';
import 'package:dds_mobile/data/entity_shadow.dart';
import 'package:dds_mobile/data/local_store.dart';
import 'package:dds_mobile/data/mutation_service.dart';

/// Fake transport — records calls and answers with the programmed result.
class FakeApi extends ApiClient {
  Object? Function(String method, String path, Object? body)? onRequest;

  @override
  Future<dynamic> request(
    String method,
    String path, {
    Object? body,
    Map<String, String>? query,
    bool useCache = true,
  }) async {
    final result = onRequest?.call(method, path, body);
    if (result is Exception) throw result;
    return result ?? <String, dynamic>{};
  }
}

void main() {
  late FakeApi api;
  late OfflineQueue queue;
  late EntityShadowStore shadow;
  late MutationService svc;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    for (final box in ['sync_queue', 'offline_cases', 'entity_shadow']) {
      await LocalStore.clear(box);
    }
    api = FakeApi();
    queue = OfflineQueue();
    shadow = EntityShadowStore();
    svc = MutationService(api, queue, shadow);
  });

  test('offline mutate applies the overlay instantly and stays queued',
      () async {
    api.assumeOffline = true;
    await shadow.put(
      'death_notification',
      'n1',
      {'notification_id': 'n1', 'status': 'under_review'},
      serverUpdatedAt: '2026-01-01T00:00:00.000Z',
    );

    final res = await svc.http(
      'PATCH',
      '/notifications/n1',
      body: {'status': 'certified'},
      entityType: 'death_notification',
      entityId: 'n1',
      overlay: {'status': 'certified'},
    );

    expect(res.status, MutationStatus.queued);
    // Overlay merged over the server copy — the UI sees the intent now.
    final eff = await shadow.effective('death_notification', 'n1');
    expect(eff?['status'], 'certified');
    expect(eff?['syncPending'], true);
    expect(await queue.count(), 1);
  });

  test('online success clears the overlay, queue entry and marks SYNCED',
      () async {
    api.assumeOffline = false;
    api.onRequest = (m, p, b) => <String, dynamic>{};

    final res = await svc.http(
      'PATCH',
      '/notifications/n1',
      entityType: 'death_notification',
      entityId: 'n1',
      overlay: {'status': 'certified'},
    );

    expect(res.status, MutationStatus.synced);
    expect(await queue.count(), 0);
    final eff = await shadow.effective('death_notification', 'n1');
    expect(eff?['syncPending'], isNull);
    final reports = await OfflineCaseStore.localReports();
    expect(reports.single['sync_status'], 'SYNCED');
  });

  test('status-0 while believed online stays queued with the overlay on',
      () async {
    api.assumeOffline = false;
    api.onRequest = (m, p, b) => ApiException(0, 'socket unreachable');

    final res = await svc.http(
      'PATCH',
      '/notifications/n1',
      entityType: 'death_notification',
      entityId: 'n1',
      overlay: {'status': 'certified'},
    );

    expect(res.status, MutationStatus.queued);
    expect(await queue.count(), 1);
    final eff = await shadow.effective('death_notification', 'n1');
    expect(eff?['status'], 'certified'); // overlay survives — pending marker
  });

  test('4xx reverts the overlay and marks the case REJECTED', () async {
    api.assumeOffline = false;
    api.onRequest = (m, p, b) => ApiException(403, 'Not allowed');
    await shadow.put(
      'death_notification',
      'n1',
      {'notification_id': 'n1', 'status': 'under_review'},
      serverUpdatedAt: '2026-01-01T00:00:00.000Z',
    );

    final res = await svc.http(
      'POST',
      '/notifications/n1/certify',
      entityType: 'death_notification',
      entityId: 'n1',
      overlay: {'status': 'certified'},
    );

    expect(res.status, MutationStatus.rejected);
    expect(() => throwIfFailed(res), throwsA(isA<ApiException>()));
    expect(await queue.count(), 0);
    // Overlay rolled back — the server copy shows through again.
    final eff = await shadow.effective('death_notification', 'n1');
    expect(eff?['status'], 'under_review');
    final reports = await OfflineCaseStore.localReports();
    expect(reports.single['sync_status'], 'REJECTED');
  });

  test('409 marks CONFLICT and drops the overlay', () async {
    api.assumeOffline = false;
    api.onRequest = (m, p, b) => ApiException(409, 'server copy won');

    final res = await svc.http(
      'PATCH',
      '/notifications/n1',
      entityType: 'death_notification',
      entityId: 'n1',
      overlay: {'clinicalSummary': 'edited offline'},
    );

    expect(res.status, MutationStatus.conflict);
    final reports = await OfflineCaseStore.localReports();
    expect(reports.single['sync_status'], 'CONFLICT');
  });

  test('shadow rows merge overlays into the effective view', () async {
    api.assumeOffline = true;
    await shadow.put(
      'death_notification',
      'n9',
      {'notification_id': 'n9', 'status': 'pending_review', 'district': 'X'},
      serverUpdatedAt: '2026-01-01T00:00:00.000Z',
    );
    await svc.http(
      'PATCH',
      '/notifications/n9',
      body: {'clinicalSummary': 'offline note'},
      entityType: 'death_notification',
      entityId: 'n9',
      overlay: {'clinicalSummary': 'offline note'},
    );

    // A list payload built from the server copy + shadow effective view
    // carries the overlay field and the pending marker.
    final serverRow = {'notification_id': 'n9', 'status': 'pending_review'};
    final eff = await shadow.effective('death_notification', 'n9');
    final merged = {...serverRow, ...?eff};
    expect(merged['clinicalSummary'], 'offline note');
    expect(merged['syncPending'], true);
  });
}
