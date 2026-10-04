import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import 'data/api_client.dart';
import 'data/auth_repository.dart';
import 'data/dds_repository.dart';
import 'data/draft_store.dart';
import 'data/sync_service.dart';
import 'data/translation_service.dart';
import 'l10n/app_localizations.dart';
import 'l10n/language_provider.dart';
import 'router.dart';
import 'ui/theme.dart';

/// Root widget — wires the data layer, restores the session and mounts
/// the declarative router (mirrors client/src/App.tsx + AuthProvider).
class DdsApp extends StatefulWidget {
  const DdsApp({super.key});

  @override
  State<DdsApp> createState() => _DdsAppState();
}

class _DdsAppState extends State<DdsApp> {
  late final ApiClient _api;
  late final AuthRepository _auth;
  late final SyncService _sync;
  late final LanguageProvider _lang;
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    _api = ApiClient();
    _auth = AuthRepository(_api);
    _api.onUnauthorized = _auth.handleUnauthorized;
    _sync = SyncService(_api, DdsRepository(_api), OfflineQueue());
    _api.onReachability = _sync.setReachable;
    _lang = LanguageProvider();
    _auth.onSessionReady = () {
      _sync.prefetchBasics();
      _lang.adoptUserLanguage(_auth.user?.language);
    };
    _router = buildRouter(_auth);
    _auth.restore().then((_) => _lang.adoptUserLanguage(_auth.user?.language));
    _sync.start();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        Provider<ApiClient>.value(value: _api),
        ChangeNotifierProvider<AuthRepository>.value(value: _auth),
        Provider<DdsRepository>(create: (_) => DdsRepository(_api)),
        ChangeNotifierProvider<SyncService>.value(value: _sync),
        ChangeNotifierProvider<LanguageProvider>.value(value: _lang),
        Provider<TranslationService>(create: (_) => TranslationService(_api)),
      ],
      child: Builder(
        builder: (context) {
          final lang = context.watch<LanguageProvider>();
          return MaterialApp.router(
            title: 'Disease Detection System',
            theme: ddsTheme(),
            routerConfig: _router,
            locale: lang.locale,
            supportedLocales: kLanguageLocales,
            localizationsDelegates: const [
              appLocalizationsDelegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            // Locales with no Material translations resolve to English chrome.
            localeResolutionCallback: (device, supported) =>
                supported.any((l) => l.languageCode == device?.languageCode)
                ? device
                : const Locale('en'),
            debugShowCheckedModeBanner: false,
          );
        },
      ),
    );
  }
}
