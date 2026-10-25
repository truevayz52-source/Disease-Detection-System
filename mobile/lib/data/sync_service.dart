import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';
import 'draft_store.dart';
import 'sync_engine.dart';
import 'sync_worker.dart';
import '../l10n/app_localizations.dart';

/// Watches server reachability and drives the offline [SyncEngine]: queue
/// flush on reconnect, periodic in-app sync while online, app-resume probe,
/// and the field-kit pull that keeps the offline dataset fresh.
///
/// `isOnline` reflects *server reachability*, not raw device connectivity:
/// a phone on mobile data has a link but cannot reach a LAN-hosted server.
/// ApiClient reports each request's outcome via [onReachability]; while
/// unreachable, `api.assumeOffline` makes reads come from the cache and
/// writes fail fast — the UI never waits out a socket timeout.
class SyncService extends ChangeNotifier with WidgetsBindingObserver {
  SyncService(this._api, this._engine, this._queue);

  final ApiClient _api;
  final SyncEngine _engine;
  final OfflineQueue _queue;

  StreamSubscription<List<ConnectivityResult>>? _sub;
  Timer? _timer;
  DateTime? _lastPrefetch;

  bool isOnline = true;
  bool syncing = false;

  /// Set when queue replay hit a 401 — items stay queued until the user
  /// signs in again (they were previously dropped = data loss).
  bool needsReauth = false;

  int pendingCount = 0;
  int conflictCount = 0;
  DateTime? lastSyncAt;
  String? lastResult;

  /// Called by ApiClient whenever a request completes or fails.
  void setReachable(bool reachable) {
    if (reachable == isOnline) return;
    isOnline = reachable;
    _api.assumeOffline = !reachable;
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
      // Bypass the assumeOffline fast-path: the probe must hit the socket.
      _api.assumeOffline = false;
      await _api.get('/health', useCache: false);
      setReachable(true);
      return true;
    } catch (_) {
      setReachable(false);
      _api.assumeOffline = !isOnline;
      return false;
    }
  }

  Future<void> start() async {
    await refreshPending();
    // Surface the outcome of any background-worker pass that ran while the
    // app was closed (expired-token 401s in particular — the queue stays).
    try {
      final prefs = await SharedPreferences.getInstance();
      if (prefs.getBool(SyncWorker.needsReauthKey) == true) {
        needsReauth = true;
      }
      lastSyncAt =
          DateTime.tryParse(prefs.getString(SyncWorker.lastSyncAtKey) ?? '') ??
          lastSyncAt;
    } catch (_) {
      /* prefs unavailable */
    }
    try {
      WidgetsBinding.instance.addObserver(this);
    } catch (_) {
      /* non-widget context (tests/background) */
    }
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
    // In-app safety net: flush every minute while the app is open and
    // online — the background worker covers the closed-app case.
    _timer = Timer.periodic(const Duration(minutes: 1), (_) {
      if (isOnline && pendingCount > 0 && !syncing) syncNow();
    });
  }

  /// App-resume: re-probe and flush — the foreground counterpart of the
  /// workmanager task.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(probe().then((_) => syncNow()));
    }
  }

  Future<void> refreshPending() async {
    pendingCount = await _queue.count();
    final reports = await OfflineCaseStore.localReports();
    conflictCount = reports.where((r) => r['sync_status'] == 'CONFLICT').length;
    notifyListeners();
  }

  /// Best-effort fetch of the main list/dashboard endpoints so every module
  /// has cached data for offline use — runs after online sign-in/restore.
  /// Failures (403 role gates, offline) are ignored per-endpoint.
  Future<void> prefetchBasics() async {
    if (!isOnline) return;
    if (_lastPrefetch != null &&
        DateTime.now().difference(_lastPrefetch!) <
            const Duration(minutes: 5)) {
      return;
    }
    _lastPrefetch = DateTime.now();
    await _engine.pullCritical();
  }

  /// Flush the queue then pull the field-kit dataset. Safe to call from
  /// multiple triggers — a pass already in flight is a no-op.
  Future<int> syncNow() async {
    if (syncing) return 0;
    syncing = true;
    notifyListeners();
    var synced = 0;
    try {
      final outcome = await _engine.flush();
      synced = outcome.synced;
      needsReauth = outcome.needsReauth;
      if (synced > 0) needsReauth = false;
      // Keep the worker-visible flag in step with the foreground result.
      unawaited(
        SharedPreferences.getInstance().then(
          (p) => p.setBool(SyncWorker.needsReauthKey, needsReauth),
        ),
      );
      lastSyncAt = outcome.finishedAt;
      lastResult = needsReauth
          ? tr('Session expired — sign in again to sync pending item(s).')
          : outcome.conflicts > 0
          ? tr('{n} synced · {c} conflict(s)', {
              'n': synced,
              'c': outcome.conflicts,
            })
          : synced > 0
          ? tr('Synced {n} item(s)', {'n': synced})
          : tr('Nothing pending');
      // Pull the field-kit so freshly landed server state replaces shadows.
      if (synced > 0 && !needsReauth) unawaited(_engine.pullCritical());
    } finally {
      syncing = false;
      await refreshPending();
    }
    return synced;
  }

  @override
  void dispose() {
    _sub?.cancel();
    _timer?.cancel();
    try {
      WidgetsBinding.instance.removeObserver(this);
    } catch (_) {
      /* not attached */
    }
    super.dispose();
  }
}
