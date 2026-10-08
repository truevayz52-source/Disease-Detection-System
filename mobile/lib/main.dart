import 'package:flutter/material.dart';

import 'app.dart';
import 'data/local_store.dart';
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
  runApp(const DdsApp());
}
