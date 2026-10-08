import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'dds_repository.dart';
import 'draft_store.dart';
import '../l10n/app_localizations.dart';

/// Watches server reachability and replays the offline mutation queue when
/// the API becomes reachable — the mobile equivalent of the web app's
/// offline-queue replay (TC-05).
///
/// `isOnline` reflects *server reachability*, not raw device connectivity:
/// a phone on mobile data has a link but cannot reach a LAN-hosted server.
/// ApiClient reports each request's outcome via [onReachability]; the
/// connectivity listener only triggers a fresh [probe] when a link returns.
class SyncService extends ChangeNotifier {
  SyncService(this._api, this._repo, this._queue);

  final ApiClient _api;
  final DdsRepository _repo;
  final OfflineQueue _queue;

  StreamSubscription<List<ConnectivityResult>>? _sub;
  DateTime? _lastPrefetch;

  bool isOnline = true;
  bool syncing = false;

  /// Set when queue replay hit a 401 — items stay queued until the user
  /// signs in again (they were previously dropped = data loss).
  bool needsReauth = false;

  int pendingCount = 0;
  DateTime? lastSyncAt;
  String? lastResult;

  /// Called by ApiClient whenever a request completes or fails.
  void setReachable(bool reachable) {
    if (reachable == isOnline) return;
    isOnline = reachable;
    notifyListeners();
    if (reachable) {
      needsReauth = false;
      syncNow();
    }
  }

  /// Lightweight server check (`GET /api/health`) that bypasses the read
  /// cache — used on app start and when device connectivity returns.
  Future<bool> probe() async {
    try {
      await _api.get('/health', useCache: false);
      setReachable(true);
      return true;
    } catch (_) {
      setReachable(false);
      return false;
    }
  }

  Future<void> start() async {
    await refreshPending();
    void track(List<ConnectivityResult> results) {
      final hasLink = results.any((r) => r != ConnectivityResult.none);
      // Slow links get longer timeouts in ApiClient — cellular and VPN
      // count; wifi/ethernet/other are treated as fast.
      _api.networkSlow =
          hasLink &&
          !results.any(
            (r) =>
                r == ConnectivityResult.wifi ||
                r == ConnectivityResult.ethernet ||
                r == ConnectivityResult.other,
          );
      if (!hasLink) {
        setReachable(false);
      } else {
        // Link returned — but the server may still be unreachable
        // (different network). Probe instead of assuming online.
        probe();
      }
    }

    try {
      _sub = Connectivity().onConnectivityChanged.listen(track);
      track(await Connectivity().checkConnectivity());
    } catch (_) {
      // Plugin unavailable (e.g. widget tests) — probe decides.
      unawaited(probe());
    }
  }

  Future<void> refreshPending() async {
    pendingCount = await _queue.count();
    notifyListeners();
  }

  /// Best-effort fetch of the main list/dashboard endpoints so every module
  /// has cached data for offline use — runs after online sign-in/restore.
  /// Failures (403 role gates, offline) are ignored per-endpoint; only
  /// successful 2xx JSON responses write to the read cache.
  Future<void> prefetchBasics() async {
    if (!isOnline) return;
    if (_lastPrefetch != null &&
        DateTime.now().difference(_lastPrefetch!) <
            const Duration(minutes: 5)) {
      return;
    }
    _lastPrefetch = DateTime.now();
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
  }

  /// Replay queued mutations in FIFO order. Stops at the first network
  /// failure (still offline); keeps entries on 401 (expired session — they
  /// can succeed after re-login); drops entries the server rejects with any
  /// other status (they can never succeed on retry).
  Future<int> syncNow() async {
    if (syncing) return 0;
    syncing = true;
    notifyListeners();
    var synced = 0;
    try {
      final items = await _queue.entries();
      for (final item in items) {
        try {
          switch (item.type) {
            case 'notification':
              await _repo.createNotification(item.data);
            case 'image':
              await _repo.uploadImage(
                item.data['notificationId'] as String,
                item.data['filePath'] as String,
              );
            default:
              break; // unknown type — drop
          }
          await _queue.remove(item.id);
          await OfflineCaseStore.markStatus(item.id, 'SYNCED');
          synced++;
        } on ApiException catch (e) {
          if (e.status == 0) break; // still no connectivity — retry later
          if (e.status == 401) {
            // Session expired — keep the queue, prompt re-login.
            needsReauth = true;
            break;
          }
          await _queue.remove(item.id); // server rejected — don't retry
          await OfflineCaseStore.markStatus(item.id, 'REJECTED');
        } catch (_) {
          break;
        }
      }
      if (synced > 0) needsReauth = false;
      lastSyncAt = DateTime.now();
      lastResult = needsReauth
          ? tr('Session expired — sign in again to sync pending item(s).')
          : synced > 0
          ? tr('Synced {n} item(s)', {'n': synced})
          : tr('Nothing pending');
    } finally {
      syncing = false;
      await refreshPending();
    }
    return synced;
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }
}
