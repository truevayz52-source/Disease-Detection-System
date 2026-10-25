import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmanager/workmanager.dart';

import 'api_client.dart';
import 'dds_repository.dart';
import 'draft_store.dart';
import 'entity_shadow.dart';
import 'local_store.dart';
import 'secure_store.dart';
import 'sync_engine.dart';

/// Background-sync worker driven by `workmanager`.
///
/// Android runs a periodic job (15-minute floor, inexact) under a
/// network-connected constraint; on iOS the task maps to BGTaskScheduler,
/// whose delivery is opportunistic. This worker is only the closed-app
/// safety net — foreground triggers (connectivity change, app resume and
/// the in-app timer in SyncService) do the prompt sync.
///
/// The task runs in a separate Flutter background isolate with no widget
/// tree: [LocalStore.init] reopens the encrypted Hive boxes, the last stored
/// JWT comes from [SecureStore], then [SyncEngine] flushes the queue and
/// refreshes the read cache. With no token stored the task exits without
/// touching the network. A 401 sets [needsReauthKey] in prefs so the next
/// foreground launch surfaces it via SyncService — the password is never
/// persisted, so there is no silent re-auth path here.
class SyncWorker {
  /// workmanager unique name and task identifier for the periodic sync job.
  static const taskName = 'dds-offline-sync';

  /// Prefs keys the worker writes for the foreground to surface.
  static const needsReauthKey = 'dds_sync_needs_reauth';
  static const lastSyncAtKey = 'dds_sync_last_at';

  /// Register the callback dispatcher and the periodic task. No-op off
  /// Android/iOS — Windows, web and tests have no worker isolate.
  static Future<void> initialize() async {
    if (!_supported) return;
    try {
      await Workmanager().initialize(callbackDispatcher);
      await Workmanager().registerPeriodicTask(
        taskName,
        taskName,
        frequency: const Duration(minutes: 15),
        constraints: Constraints(networkType: NetworkType.connected),
        existingWorkPolicy: ExistingPeriodicWorkPolicy.keep,
      );
    } catch (e) {
      debugPrint('[sync_worker] initialize failed: $e');
    }
  }

  /// Drop the scheduled task — wired to "remove offline access" sign-out.
  static Future<void> cancel() async {
    if (!_supported) return;
    try {
      await Workmanager().cancelByUniqueName(taskName);
    } catch (_) {
      /* plugin unavailable */
    }
  }

  static bool get _supported =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);
}

/// Entry point invoked by the workmanager plugin in the background isolate.
@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    try {
      await LocalStore.init();
      final api = ApiClient();
      // Mirrors AuthRepository._tokenKey — the worker reuses the live
      // session; an expired token yields 401 → needsReauth, not a refresh.
      api.token = await SecureStore.read('dds_token', legacyKey: 'dds_token');
      if (api.token == null) return true; // signed out — nothing to replay
      await api.init(); // saved override / last-good server URL

      final engine = SyncEngine(
        api,
        DdsRepository(api),
        OfflineQueue(),
        EntityShadowStore(),
      );
      final outcome = await engine.flush();
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(SyncWorker.needsReauthKey, outcome.needsReauth);
      await prefs.setString(
        SyncWorker.lastSyncAtKey,
        outcome.finishedAt.toIso8601String(),
      );
      if (!outcome.halted && !outcome.needsReauth) {
        await engine.pullCritical();
      }
      return true;
    } catch (e) {
      debugPrint('[sync_worker] task failed: $e');
      return false;
    }
  });
}
