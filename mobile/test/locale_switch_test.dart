import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:dds_mobile/l10n/app_localizations.dart';
import 'package:dds_mobile/l10n/fallback_localizations.dart';
import 'package:dds_mobile/l10n/language_provider.dart';

/// Regression test for the "No MaterialLocalizations found" red screen:
/// switching to any of the 16 configured languages must leave a working
/// Material/Widgets/Cupertino Localizations in the tree — several of our
/// language codes (nd, kck, sbn, huc, nmq, ndc, toi, ts, ve, zsl) are not
/// covered by flutter_localizations, so the Default* delegates in app.dart
/// are the backstop. This test mirrors that delegate ordering.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Widget host(Locale locale) => MaterialApp(
    locale: locale,
    supportedLocales: kLanguageLocales,
    // Same ordering as app.dart — fallbacks first, Global* override when
    // the locale has real translations.
    localizationsDelegates: const [
      fallbackMaterialLocalizations,
      fallbackWidgetsLocalizations,
      fallbackCupertinoLocalizations,
      appLocalizationsDelegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    // A Scaffold with a drawer is exactly what threw on device —
    // DrawerController needs MaterialLocalizations.
    home: const Scaffold(
      drawer: Drawer(child: Text('drawer')),
      body: Center(child: Text('body')),
    ),
  );

  for (final lang in kLanguages) {
    testWidgets('locale ${lang.code} provides MaterialLocalizations', (
      tester,
    ) async {
      await tester.pumpWidget(host(Locale(lang.code)));
      await tester.pumpAndSettle();

      // Would throw FlutterError if the delegate chain is missing.
      final ctx = tester.element(find.text('body'));
      expect(
        MaterialLocalizations.of(ctx),
        isNotNull,
        reason: '${lang.code} must fall back to English material chrome',
      );
      expect(
        Localizations.of<WidgetsLocalizations>(ctx, WidgetsLocalizations),
        isNotNull,
      );
    });
  }
}
