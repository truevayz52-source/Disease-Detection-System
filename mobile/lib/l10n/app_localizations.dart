import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// UI localisation engine — mirrors the web client's `t()` in
/// client/src/lib/preferences.tsx. Keys are English source strings; a
/// missing translation returns the key itself, so screens always render
/// readable English rather than a raw symbolic key.
///
/// Dictionaries live in assets/lang/<code>.json, synced from the canonical
/// i18n/lang/ directory at the repo root (`pnpm i18n:sync`). A server-side
/// overlay (`/api/i18n/:lang`) can be merged on top to supply updated or
/// generated translations without an app rebuild.
class AppLocalizations {
  AppLocalizations(this.locale);

  final Locale locale;

  /// The active dictionary — set on every delegate load. Static so `tr()`
  /// works without a BuildContext (e.g. inside data formatters).
  static Map<String, String> _active = const {};
  static String _activeCode = 'en';

  /// Bundled dictionaries loaded from the asset bundle at app startup.
  static final Map<String, Map<String, String>> _bundled = {};

  /// Server-side overlay per language (filled by `setRemote`).
  static final Map<String, Map<String, String>> _remote = {};

  /// Effective merged dictionary per language.
  static final Map<String, Map<String, String>> _merged = {};

  Map<String, String> _strings = const {};

  static AppLocalizations of(BuildContext context) =>
      Localizations.of<AppLocalizations>(context, AppLocalizations)!;

  static AppLocalizations? maybeOf(BuildContext context) =>
      Localizations.of<AppLocalizations>(context, AppLocalizations);

  /// Load all bundled dictionaries in parallel. Call before `runApp()` in
  /// main(); the small startup cost is repaid by immediate language switches.
  static Future<void> preloadAll(List<String> codes) async {
    if (_bundled.isNotEmpty) return;
    await Future.wait(
      codes.map(
        (code) => rootBundle
            .loadString('assets/lang/$code.json')
            .then((raw) {
              try {
                final decoded = json.decode(raw) as Map<String, dynamic>;
                _bundled[code] = decoded.map(
                  (k, v) => MapEntry(k, v.toString()),
                )..removeWhere((k, _) => k.startsWith('_'));
              } on FormatException {
                _bundled[code] = const {};
              }
            })
            .catchError((_) => _bundled[code] = const {}),
      ),
    );
    for (final code in codes) {
      _merged[code] = {..._bundled[code] ?? const {}};
    }
    setActive('en');
  }

  /// Merge a dictionary fetched from `/api/i18n/:lang` on top of the bundled
  /// data. Callers (usually `LanguageProvider`) supply the payload decoded by
  /// `ApiClient` so this class avoids importing `api_client.dart` (which
  /// already imports this file for `tr()`).
  static void setRemote(String code, Map<String, String> dict) {
    _remote[code] = dict;
    _merged[code] = {..._bundled[code] ?? const {}, ...dict};
    if (_activeCode == code) setActive(code);
  }

  /// Set the currently active language. Updates the process-wide `_active`
  /// dictionary so global `tr()` calls reflect the new locale synchronously.
  static void setActive(String code) {
    _activeCode = code;
    _active = _merged[code] ?? const {};
  }

  /// Synchronous — the effective dictionary was already built by
  /// [preloadAll] and/or [setRemote].
  void load() {
    _activeCode = locale.languageCode;
    _strings = _merged[locale.languageCode] ?? const {};
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
  Future<AppLocalizations> load(Locale locale) {
    final l10n = AppLocalizations(locale);
    l10n.load();
    return SynchronousFuture<AppLocalizations>(l10n);
  }

  @override
  bool shouldReload(AppLocalizationsDelegate old) => true;
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
