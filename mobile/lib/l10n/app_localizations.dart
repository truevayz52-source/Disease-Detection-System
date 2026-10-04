import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// UI localisation engine — mirrors the web client's `t()` in
/// client/src/lib/preferences.tsx. Keys are English source strings; a
/// missing translation returns the key itself, so screens always render
/// readable English rather than a raw symbolic key.
///
/// Dictionaries live in assets/lang/<code>.json, synced from the canonical
/// i18n/lang/ directory at the repo root (`pnpm i18n:sync`).
class AppLocalizations {
  AppLocalizations(this.locale);

  final Locale locale;

  /// The active dictionary — set on every delegate load. Static so `tr()`
  /// works without a BuildContext (e.g. inside data formatters).
  static Map<String, String> _active = const {};

  Map<String, String> _strings = const {};

  static AppLocalizations of(BuildContext context) =>
      Localizations.of<AppLocalizations>(context, AppLocalizations)!;

  static AppLocalizations? maybeOf(BuildContext context) =>
      Localizations.of<AppLocalizations>(context, AppLocalizations);

  Future<void> load() async {
    try {
      final raw = await rootBundle.loadString(
        'assets/lang/${locale.languageCode}.json',
      );
      _strings = (json.decode(raw) as Map<String, dynamic>).map(
        (k, v) => MapEntry(k, v.toString()),
      )..removeWhere((k, _) => k.startsWith('_'));
    } on FlutterError {
      _strings = const {}; // no asset for this locale → English fallback
    }
    _active = _strings;
  }

  static String applyVars(String text, Map<String, Object?>? vars) {
    if (vars == null) return text;
    var out = text;
    for (final e in vars.entries) {
      out = out.replaceAll('{${e.key}}', '${e.value}');
    }
    return out;
  }

  String translate(String key, [Map<String, Object?>? vars]) =>
      applyVars(_strings[key] ?? key, vars);
}

class AppLocalizationsDelegate extends LocalizationsDelegate<AppLocalizations> {
  const AppLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) => true; // English fallback covers all

  @override
  Future<AppLocalizations> load(Locale locale) async {
    final l10n = AppLocalizations(locale);
    await l10n.load();
    return l10n;
  }

  @override
  bool shouldReload(AppLocalizationsDelegate old) => false;
}

const appLocalizationsDelegate = AppLocalizationsDelegate();

/// `tr('English literal')` → translated string. Optional `{placeholder}`
/// interpolation: `tr('{n} items pending', {'n': count})`.
/// Works without a BuildContext — the active dictionary is process-wide and
/// every widget re-renders when the locale changes.
String tr(String key, [Map<String, Object?>? vars]) =>
    AppLocalizations.applyVars(AppLocalizations._active[key] ?? key, vars);

/// Context flavour for call sites that prefer it (`context.tr('...')`).
extension Tr on BuildContext {
  String tr(String key, [Map<String, Object?>? vars]) =>
      AppLocalizations.maybeOf(this)?.translate(key, vars) ??
      AppLocalizations.applyVars(key, vars);
}
