import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import 'api_client.dart';
import 'draft_store.dart';
import 'entity_shadow.dart';
import 'sync_ops.dart';

/// Result of [MutationService.mutate].
enum MutationStatus {
  /// Sent and accepted by the server inline.
  synced,

  /// Queued for replay (offline, or an online attempt hit status 0). The
  /// optimistic overlay stays applied — the UI keeps showing the change.
  queued,

  /// Server refused it outright — the overlay was rolled back.
  rejected,

  /// A newer server write won the last-write-wins comparison.
  conflict,
}

class MutationResult {
  final MutationStatus status;
  final QueuedOp op;
  final ApiException? error;
  const MutationResult(this.status, this.op, [this.error]);

  bool get pending => status == MutationStatus.queued;
}

/// Screens that previously awaited a direct API call can swap it for a
/// `MutationService.http(...)` result and pass it here: synced/queued both
/// count as handled (queued replays later), rejected/conflict rethrow the
/// server error so existing catch blocks render it unchanged.
void throwIfFailed(MutationResult res) {
  if (res.status == MutationStatus.rejected ||
      res.status == MutationStatus.conflict) {
    throw res.error ?? ApiException(400, 'Request failed');
  }
}

/// Optimistic-write service — the single entry point for every mutation in
/// the app. Write path: enqueue the op → apply the overlay instantly →
/// notify listeners (UI updates before any network I/O) → if online, attempt
/// the send inline and reconcile.
///
/// This gives the "instant feel": the change renders immediately with a
/// pending marker, and either syncs silently or rolls back with an error.
/// When offline the op is queued and flushed by SyncEngine (foreground
/// triggers or the workmanager task).
class MutationService extends ChangeNotifier {
  MutationService(this._api, this._queue, this._shadow);

  static const _uuid = Uuid();

  final ApiClient _api;
  final OfflineQueue _queue;
  final EntityShadowStore _shadow;

  /// Build-and-mutate helpers for the three op kinds. [overlay] is merged
  /// into the entity shadow so list/detail screens reflect the change
  /// instantly; pass null for fire-and-forget ops (uploads).
  Future<MutationResult> http(
    String method,
    String path, {
    Map<String, dynamic> body = const {},
    String entityType = '',
    String entityId = '',
    Map<String, dynamic>? overlay,
    String? coalesceKey,
  }) => mutate(
    QueuedOp.http(
      id: _uuid.v4(),
      method: method,
      path: path,
      body: body,
      entityType: entityType,
      entityId: entityId,
      coalesceKey: coalesceKey,
      queuedAt: DateTime.now(),
    ),
    overlay: overlay,
  );

  Future<MutationResult> notification(
    Map<String, dynamic> payload, {
    Map<String, dynamic>? overlay,
  }) => mutate(
    QueuedOp.notification(
      id: _uuid.v4(),
      payload: payload,
      queuedAt: DateTime.now(),
    ),
    overlay: overlay,
  );

  Future<MutationResult> upload(
    String path,
    String filePath, {
    Map<String, String> fields = const {},
    String entityType = '',
    String entityId = '',
  }) => mutate(
    QueuedOp.multipart(
      id: _uuid.v4(),
      path: path,
      filePath: filePath,
      fields: fields,
      entityType: entityType,
      entityId: entityId,
      queuedAt: DateTime.now(),
    ),
  );

  /// Enqueue [op], apply [overlay] optimistically, then attempt an inline
  /// send while the server is believed reachable.
  Future<MutationResult> mutate(
    QueuedOp op, {
    Map<String, dynamic>? overlay,
  }) async {
    await _queue.enqueueOp(op);
    if (overlay != null) await _shadow.applyOverlay(op, overlay);
    notifyListeners();

    if (_api.assumeOffline) {
      return MutationResult(MutationStatus.queued, op);
    }
    try {
      await _send(op);
      await _queue.remove(op.id);
      await _shadow.clearOverlay(op.entityType, op.entityId, op.id);
      await OfflineCaseStore.markStatus(op.id, 'SYNCED');
      notifyListeners();
      return MutationResult(MutationStatus.synced, op);
    } on ApiException catch (e) {
      if (e.status == 0) {
        // Unreachable after all — stays queued, overlay stays on.
        notifyListeners();
        return MutationResult(MutationStatus.queued, op);
      }
      if (e.status == 409) {
        await _queue.remove(op.id);
        await _shadow.clearOverlay(op.entityType, op.entityId, op.id);
        await OfflineCaseStore.markStatus(op.id, 'CONFLICT', error: e.message);
        notifyListeners();
        return MutationResult(MutationStatus.conflict, op, e);
      }
      await _queue.remove(op.id);
      await _shadow.clearOverlay(op.entityType, op.entityId, op.id);
      await OfflineCaseStore.markStatus(op.id, 'REJECTED', error: e.message);
      notifyListeners();
      return MutationResult(MutationStatus.rejected, op, e);
    } catch (e) {
      // Unexpected — keep it queued rather than lose the write.
      notifyListeners();
      return MutationResult(MutationStatus.queued, op);
    }
  }

  /// Roll back a pending op the user discarded on the Offline Sync screen.
  Future<void> discard(String opId) async {
    final op = await _queue.get(opId);
    await _queue.remove(opId);
    if (op != null) {
      await _shadow.clearOverlay(op.entityType, op.entityId, op.id);
      await OfflineCaseStore.markStatus(opId, 'DISCARDED');
    }
    notifyListeners();
  }

  Future<void> _send(QueuedOp op) async {
    switch (op.kind) {
      case 'notification':
        await _api.post('/notifications', body: {
          ...op.body,
          'submissionId': op.id,
        });
      case 'http':
        await _api.request(op.method ?? 'POST', op.path!, body: op.wireBody());
      case 'multipart':
        if (op.filePath == null || op.path == null) {
          throw ApiException(400, 'Malformed upload op');
        }
        await _api.postMultipart(op.path!, op.filePath!, fields: op.fields);
    }
  }
}
