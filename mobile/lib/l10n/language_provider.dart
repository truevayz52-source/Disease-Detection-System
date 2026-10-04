import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/api_client.dart';

/// One entry per official language of Zimbabwe (Constitution, s.6) — mirrors
/// i18n/languages.json at the repo root. `written=false` marks Zimbabwe Sign
/// Language: it has no text dictionary, so the UI renders English plus an
/// explanatory notice.
class LanguageInfo {
  final String code;
  final String name;
  final String nativeName;
  final bool written;
  const LanguageInfo(this.code, this.name, this.nativeName, {this.written = true});
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
  LanguageInfo('zsl', 'Zimbabwe Sign Language', 'Zimbabwe Sign Language', written: false),
];

final kLanguageLocales = kLanguages.map((l) => Locale(l.code)).toList();

LanguageInfo languageInfo(String code) =>
    kLanguages.firstWhere((l) => l.code == code, orElse: () => kLanguages.first);

/// App-wide locale state. Device selection persists in SharedPreferences
/// ('dds_locale'); when signed in, the choice is also written to the user's
/// server profile (PATCH /user/profile — the server accepts all 16 codes),
/// and a returning session adopts its account language on devices that have
/// not made a local choice.
class LanguageProvider extends ChangeNotifier {
  static const _prefKey = 'dds_locale';

  Locale _locale = const Locale('en');
  Locale get locale => _locale;
  String get code => _locale.languageCode;
  bool get isEnglish => _locale.languageCode == 'en';
  bool get isSignLanguage => _locale.languageCode == 'zsl';

  LanguageProvider() {
    _restore();
  }

  Future<void> _restore() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_prefKey);
      if (saved != null && kLanguages.any((l) => l.code == saved)) {
        _locale = Locale(saved);
        notifyListeners();
      }
    } catch (_) {/* prefs unavailable — stay on English */}
  }

  Future<void> setLanguage(String code, {ApiClient? api}) async {
    if (!kLanguages.any((l) => l.code == code)) return;
    _locale = Locale(code);
    notifyListeners();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefKey, code);
    } catch (_) {}
    // Best-effort profile sync — the choice still applies locally if offline.
    if (api != null && api.token != null) {
      try {
        await api.patch('/user/profile', body: {'language': code});
      } catch (_) {}
    }
  }

  /// Adopt the account's stored language when this device has no explicit
  /// local choice (called on session restore and after sign-in).
  Future<void> adoptUserLanguage(String? lang) async {
    if (lang == null || !kLanguages.any((l) => l.code == lang)) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      if (prefs.getString(_prefKey) != null) return; // local choice wins
      _locale = Locale(lang);
      notifyListeners();
    } catch (_) {}
  }
}
