import 'dart:async';

import 'api_client.dart';
import 'dds_repository.dart';
import 'draft_store.dart';
import 'entity_shadow.dart';
import 'sync_ops.dart';

/// Result of a flush pass — surfaced by SyncService as UI state and written
/// to prefs by the background worker.
class SyncOutcome {
  int synced = 0;
  int conflicts = 0;
  int rejected = 0;
  int remaining = 0;
  bool halted = false;
  bool needsReauth = false;
  DateTime finishedAt = DateTime.now();
}

/// UI-free offline sync engine — safe to run from the foreground
/// SyncService AND the workmanager background isolate (no Flutter widget
/// imports; Hive works headless once LocalStore.init() has run).
///
/// Push (flush): replays the FIFO queue. Notification creates are batched
/// through `POST /offline/sync` (idempotent via submissionId); every other
/// op replays through its canonical REST path so existing server auth,
/// role guards and the case state machine all still apply.
///
/// Outcome classification per op:
///   - 2xx            → SYNCED, overlay cleared
///   - 409            → CONFLICT (server write won the LWW comparison or the
///                      state machine rejected a stale transition) — shadow
///                      record kept for audit, overlay dropped
///   - other 4xx      → REJECTED, optimistic overlay rolled back
///   - status 0       → halt the pass (still offline); per-op backoff via
///                      `attempts` — op is retried on the next trigger
///   - 401            → halt + needsReauth; the queue is kept untouched
///
/// Pull (pullCritical): refreshes the read cache for the field-kit dataset
/// and resolves entity shadows against the server versions.
class SyncEngine {
  SyncEngine(this._api, this._repo, this._queue, this._shadow);

  final ApiClient _api;
  final DdsRepository _repo;
  final OfflineQueue _queue;
  final EntityShadowStore _shadow;

  /// Server batch endpoint accepts at most 20 items.
  static const _batchSize = 20;

  /// After this many halted attempts an op is parked — the pass skips it
  /// until the next connectivity change resets the counter. Prevents a
  /// poisoned first item from starving the queue.
  static const _maxAttempts = 5;

  /// Replay all pending ops. Returns the outcome summary.
  Future<SyncOutcome> flush() async {
    final outcome = SyncOutcome();
    final items = await _queue.entries();
    if (items.isEmpty) return outcome;

    // Notification creates go through the idempotent batch endpoint.
    final notifications = items.where((o) => o.kind == 'notification');
    await _flushNotificationBatch(notifications.toList(), outcome);
    if (outcome.halted) {
      outcome.remaining = await _queue.count();
      return outcome;
    }

    // Everything else replays individually in FIFO order.
    for (final op in items.where((o) => o.kind != 'notification')) {
      if (op.attempts >= _maxAttempts) continue; // parked — retry next pass
      try {
        await _replay(op);
        await _queue.remove(op.id);
        await _shadow.clearOverlay(op.entityType, op.entityId, op.id);
        await OfflineCaseStore.markStatus(op.id, 'SYNCED');
        outcome.synced++;
      } on ApiException catch (e) {
        if (e.status == 0) {
          await _queue.markAttempt(op.id, e.message);
          outcome.halted = true;
          break;
        }
        if (e.status == 401) {
          outcome.needsReauth = true;
          outcome.halted = true;
          break;
        }
        if (e.status == 409) {
          await _queue.remove(op.id);
          await _shadow.clearOverlay(op.entityType, op.entityId, op.id);
          await OfflineCaseStore.markStatus(
            op.id,
            'CONFLICT',
            error: e.message,
          );
          outcome.conflicts++;
          continue;
        }
        await _queue.remove(op.id);
        await _shadow.clearOverlay(op.entityType, op.entityId, op.id);
        await OfflineCaseStore.markStatus(op.id, 'REJECTED', error: e.message);
        outcome.rejected++;
      } catch (e) {
        await _queue.markAttempt(op.id, '$e');
        outcome.halted = true;
        break;
      }
    }
    outcome.remaining = await _queue.count();
    outcome.finishedAt = DateTime.now();
    return outcome;
  }

  /// Batch notification creates through POST /offline/sync. The endpoint
  /// dedupes on submissionId (the op id), so re-flushing after a partial
  /// failure is safe.
  Future<void> _flushNotificationBatch(
    List<QueuedOp> ops,
    SyncOutcome outcome,
  ) async {
    for (var i = 0; i < ops.length; i += _batchSize) {
      final chunk = ops.sublist(i, (i + _batchSize).clamp(0, ops.length));
      dynamic res;
      try {
        res = await _api.post(
          '/offline/sync',
          body: {
            'items': [
              for (final op in chunk)
                {
                  'id': op.id,
                  'payload': op.body,
                  'clientUpdatedAt': op.clientUpdatedAt.toIso8601String(),
                },
            ],
          },
        );
      } on ApiException catch (e) {
        for (final op in chunk) {
          await _queue.markAttempt(op.id, e.message);
        }
        if (e.status == 401) outcome.needsReauth = true;
        outcome.halted = true;
        return;
      } catch (e) {
        for (final op in chunk) {
          await _queue.markAttempt(op.id, '$e');
        }
        outcome.halted = true;
        return;
      }
      for (final r in (res['results'] as List? ?? const [])) {
        final id = r['id']?.toString() ?? '';
        final op = chunk.where((o) => o.id == id).firstOrNull;
        if (op == null) continue;
        switch (r['status']) {
          case 'synced':
            await _queue.remove(id);
            await _shadow.clearOverlay(op.entityType, op.entityId, id);
            await OfflineCaseStore.markStatus(id, 'SYNCED');
            outcome.synced++;
          case 'conflict':
            await _queue.remove(id);
            await _shadow.clearOverlay(op.entityType, op.entityId, id);
            await OfflineCaseStore.markStatus(
              id,
              'CONFLICT',
              error: r['error']?.toString(),
              serverUpdatedAt: r['serverUpdatedAt']?.toString(),
            );
            outcome.conflicts++;
          default:
            if (r['retryable'] == true) {
              await _queue.markAttempt(id, r['error']?.toString() ?? 'failed');
            } else {
              await _queue.remove(id);
              await _shadow.clearOverlay(op.entityType, op.entityId, id);
              await OfflineCaseStore.markStatus(
                id,
                'REJECTED',
                error: r['error']?.toString(),
              );
              outcome.rejected++;
            }
        }
      }
    }
  }

  /// Replay a single non-notification op through its canonical endpoint.
  Future<void> _replay(QueuedOp op) async {
    switch (op.kind) {
      case 'http':
        await _api.request(op.method ?? 'POST', op.path!, body: op.wireBody());
      case 'multipart':
        if (op.filePath == null || op.path == null) {
          throw ApiException(400, 'Malformed upload op');
        }
        await _api.postMultipart(op.path!, op.filePath!, fields: op.fields);
      default:
        throw ApiException(400, 'Unknown op kind: ${op.kind}');
    }
  }

  /// Refresh the field-kit dataset (critical offline data) — GETs populate
  /// the encrypted read cache; notification/autopsy rows resolve entity
  /// shadows so freshly synced server versions replace stale overlays.
  Future<void> pullCritical() async {
    final calls = <Future<dynamic> Function()>[
      _repo.dashboard,
      () => _repo.trends(),
      _repo.clusters,
      () => _repo.notifications(),
      () => _repo.alerts(),
      _repo.alertStats,
      _repo.facilities,
      () => _repo.icdCodes(''),
      _repo.autopsies,
    ];
    for (final call in calls) {
      try {
        await call();
      } catch (_) {
        /* role-gated or unreachable — skip */
      }
    }
    // Resolve shadows for entities we hold — a newer server row drops the
    // pending overlay (last write wins).
    try {
      final items = await _repo.notifications();
      for (final n in items) {
        await _shadow.resolveFromServer(
          'death_notification',
          n.notificationId,
          {'notification_id': n.notificationId, 'status': n.status},
        );
      }
    } catch (_) {
      /* offline or role-gated */
    }
    try {
      final alerts = await _repo.alerts();
      for (final a in alerts) {
        await _shadow.resolveFromServer(
          'alert',
          a.alertId,
          {'alert_id': a.alertId, 'status': a.status},
        );
      }
    } catch (_) {
      /* skip */
    }
  }
}
