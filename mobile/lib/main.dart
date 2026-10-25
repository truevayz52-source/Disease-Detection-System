import 'dart:async';

import 'package:flutter/material.dart';

import 'app.dart';
import 'data/local_store.dart';
import 'data/sync_worker.dart';
import 'l10n/app_localizations.dart';
import 'l10n/language_provider.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Future.wait([
    LocalStore.init(),
    AppLocalizations.preloadAll(
      kLanguageLocales.map((l) => l.languageCode).toList(),
    ),
  ]);
  // Closed-app safety net — Android/iOS only, all other targets no-op.
  unawaited(SyncWorker.initialize());
  runApp(const DdsApp());
}
