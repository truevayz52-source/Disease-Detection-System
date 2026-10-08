import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/api_client.dart';
import 'app_localizations.dart';

/// One entry per official language of Zimbabwe (Constitution, s.6) — mirrors
/// i18n/languages.json at the repo root. `written=false` marks Zimbabwe Sign
/// Language: it has no text dictionary, so the UI renders English plus an
/// explanatory notice.
class LanguageInfo {
  final String code;
  final String name;
  final String nativeName;
  final bool written;
  const LanguageInfo(
    this.code,
    this.name,
    this.nativeName, {
    this.written = true,
  });
}

const kLanguages = <LanguageInfo>[
  LanguageInfo('en', 'English', 'English'),
  LanguageInfo('sn', 'Shona', 'chiShona'),
  LanguageInfo('nd', 'Ndebele', 'isiNdebele'),
  LanguageInfo('ny', 'Chewa', 'Chichewa / Chinyanja'),
  LanguageInfo('sbn', 'Chibarwe', 'Chibarwe'),
  LanguageInfo('kck', 'Kalanga', 'TjiKalanga'),
  LanguageInfo('huc', 'Koisan (Tshwa)', 'Tshwa'),
  LanguageInfo('nmq', 'Nambya', 'ChiNambya'),
  LanguageInfo('ndc', 'Ndau', 'ChiNdau'),
  LanguageInfo('ts', 'Shangani (Tsonga)', 'Xitsonga'),
  LanguageInfo('st', 'Sotho', 'Sesotho'),
  LanguageInfo('toi', 'Tonga', 'chiTonga'),
  LanguageInfo('tn', 'Tswana', 'Setswana'),
  LanguageInfo('ve', 'Venda', 'Tshivenda'),
  LanguageInfo('xh', 'Xhosa', 'isiXhosa'),
  LanguageInfo(
    'zsl',
    'Zimbabwe Sign Language',
    'Zimbabwe Sign Language',
    written: false,
  ),
];

final kLanguageLocales = kLanguages.map((l) => Locale(l.code)).toList();

LanguageInfo languageInfo(String code) => kLanguages.firstWhere(
  (l) => l.code == code,
  orElse: () => kLanguages.first,
);

/// App-wide locale state. Device selection persists in SharedPreferences
/// ('dds_locale'); when signed in, the choice is also written to the user'
/// server profile (PATCH /user/profile — the server accepts all 16 codes),
/// and a returning session adopts its account language on devices that have
/// not made a local choice.
///
/// Online dictionaries are fetched from `/api/i18n/:lang` and merged on top
/// of the bundled assets so updated or generated translations take effect
/// without an app rebuild.
class LanguageProvider extends ChangeNotifier {
  static const _prefKey = 'dds_locale';

  Locale _locale = const Locale('en');
  Locale get locale => _locale;
  String get code => _locale.languageCode;
  bool get isEnglish => _locale.languageCode == 'en';
  bool get isSignLanguage => _locale.languageCode == 'zsl';

  ApiClient? _api;
  bool _restored = false;

  LanguageProvider() {
    _restore();
  }

  /// Bind the API client so remote dictionary fetches can use the session
  /// token. Call immediately after creating the provider.
  void bindApi(ApiClient api) {
    _api = api;
    if (_restored) _maybeLoadRemote(_locale.languageCode);
  }

  Future<void> _restore() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_prefKey);
      if (saved != null && kLanguages.any((l) => l.code == saved)) {
        _locale = Locale(saved);
      }
    } catch (_) {
      /* prefs unavailable — stay on English */
    }
    _restored = true;
    AppLocalizations.setActive(_locale.languageCode);
    notifyListeners();
    _maybeLoadRemote(_locale.languageCode);
  }

  Future<void> _maybeLoadRemote(String code) async {
    final api = _api;
    if (api == null || api.token == null) return;
    try {
      final res = await api.get('/i18n/$code');
      if (res is Map) {
        AppLocalizations.setRemote(
          code,
          res.map((k, v) => MapEntry('$k', '$v')),
        );
        AppLocalizations.setActive(code);
        notifyListeners();
      }
    } catch (_) {
      // Offline or unauthenticated — bundled dictionaries still work.
    }
  }

  Future<void> setLanguage(String code, {ApiClient? api}) async {
    if (!kLanguages.any((l) => l.code == code)) return;
    _locale = Locale(code);
    // Note: Intl.defaultLocale is deliberately NOT set — intl has no date
    // data for most of these locales and DateFormat would throw
    // LocaleDataException. Pattern-based formats stay English-ordered.
    AppLocalizations.setActive(code);
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefKey, code);
    } catch (_) {}
    // Best-effort profile sync — the choice still applies locally if offline.
    final client = api ?? _api;
    if (client != null && client.token != null) {
      try {
        await client.patch('/user/profile', body: {'language': code});
      } catch (_) {}
    }
    // Fetch latest server-side dictionary overlay for this language.
    await _maybeLoadRemote(code);
  }

  /// Adopt the account's stored language when this device has no explicit
  /// local choice (called on session restore and after sign-in).
  Future<void> adoptUserLanguage(String? lang) async {
    if (lang == null || !kLanguages.any((l) => l.code == lang)) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      if (prefs.getString(_prefKey) != null) return; // local choice wins
      _locale = Locale(lang);
      AppLocalizations.setActive(lang);
      notifyListeners();
      await _maybeLoadRemote(lang);
    } catch (_) {}
  }
}
