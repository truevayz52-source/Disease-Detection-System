import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;
import 'package:http/http.dart' as http;

import 'api_client.dart';
import 'deidentify.dart';

/// Where a rendered translation came from.
enum TranslateSource { provider, cache, glossary, original }

class TranslationResult {
  final String text;
  final TranslateSource source;
  const TranslationResult(this.text, this.source);
}

/// Dynamic-content translation for clinical text (autopsy findings, clinical
/// summaries, transcripts). Order of operations:
///   1. in-memory cache
///   2. POST /api/translate  (server masks PII → Gemini; key never on device)
///   3. direct Gemini — only when built with --dart-define DDS_TRANSLATE_KEY
///      (text is de-identified on-device before dispatch)
///   4. offline glossary substitution (assets/lang/medical-glossary.json)
///   5. original text
///
/// `pii` literals (patient name, national ID, facility, pathologist…) are
/// supplied by the caller from the loaded record so the server can mask them.
class TranslationService {
  TranslationService(this._api);

  final ApiClient _api;
  final _mem = <String, TranslationResult>{};

  static const _geminiKey = String.fromEnvironment('DDS_TRANSLATE_KEY');
  static const _geminiModel = String.fromEnvironment(
    'DDS_TRANSLATE_MODEL',
    defaultValue: 'gemini-1.5-flash',
  );

  static const _langNames = {
    'sn': 'chiShona', 'nd': 'isiNdebele', 'ny': 'Chichewa / Chinyanja',
    'sbn': 'Chibarwe', 'kck': 'TjiKalanga', 'huc': 'Tshwa',
    'nmq': 'ChiNambya', 'ndc': 'ChiNdau', 'ts': 'Xitsonga',
    'st': 'Sesotho', 'toi': 'chiTonga', 'tn': 'Setswana',
    've': 'Tshivenda', 'xh': 'isiXhosa',
  };

  Map<String, Map<String, String>>? _glossary;
  Future<Map<String, String>> _glossaryFor(String lang) async {
    _glossary ??= await _loadGlossary();
    return _glossary![lang] ?? const {};
  }

  Future<Map<String, Map<String, String>>> _loadGlossary() async {
    try {
      final raw =
          await rootBundle.loadString('assets/lang/medical-glossary.json');
      final decoded = json.decode(raw) as Map<String, dynamic>;
      return {
        for (final e in decoded.entries)
          if (!e.key.startsWith('_'))
            e.key: (e.value as Map).map((k, v) => MapEntry('$k', '$v')),
      };
    } catch (_) {
      return const {};
    }
  }

  Future<TranslationResult> translate(
    String text,
    String targetLang, {
    List<String> pii = const [],
  }) async {
    if (text.trim().isEmpty ||
        targetLang == 'en' ||
        targetLang == 'zsl') {
      return TranslationResult(text, TranslateSource.original);
    }
    final key = '$targetLang|$text';
    final hit = _mem[key];
    if (hit != null) return hit;

    // 1 — server proxy (preferred: centralised key + audit)
    try {
      final res = await _api.post('/translate', body: {
        'text': text,
        'targetLang': targetLang,
        if (pii.isNotEmpty) 'pii': pii,
      }) as Map<String, dynamic>;
      final map = (res['map'] as Map?)?.cast<String, String>() ?? const {};
      final out = TranslationResult(
        unmaskPii(res['translated']?.toString() ?? text, map),
        TranslateSource.provider,
      );
      _mem[key] = out;
      return out;
    } catch (_) {/* fall through to direct/offline paths */}

    // 2 — direct Gemini (opt-in dart-define; de-identified on-device first)
    if (_geminiKey.isNotEmpty) {
      try {
        final out = await _translateDirect(text, targetLang, pii);
        _mem[key] = out;
        return out;
      } catch (_) {/* offline fallback below */}
    }

    // 3 — bundled medical glossary substitution (fully offline; nothing
    // leaves the device, so no masking is needed).
    final gloss = await _glossaryFor(targetLang);
    if (gloss.isNotEmpty) {
      var sub = text;
      var changed = false;
      for (final e in gloss.entries) {
        final before = sub;
        sub = sub.replaceAll(
          RegExp('\\b${RegExp.escape(e.key)}\\b', caseSensitive: false),
          e.value,
        );
        if (sub != before) changed = true;
      }
      if (changed) {
        final out = TranslationResult(sub, TranslateSource.glossary);
        _mem[key] = out;
        return out;
      }
    }

    final out = TranslationResult(text, TranslateSource.original);
    _mem[key] = out;
    return out;
  }

  /// Direct provider call used only when DDS_TRANSLATE_KEY is compiled in.
  /// The provider sees de-identified text (⟦n⟧ placeholders) — the caller's
  /// PII literals and regex catches are stripped first.
  Future<TranslationResult> _translateDirect(
    String text,
    String targetLang,
    List<String> pii,
  ) async {
    final m = maskPii(text, pii);
    final langName = _langNames[targetLang] ?? targetLang;
    final res = await http
        .post(
          Uri.parse(
            'https://generativelanguage.googleapis.com/v1beta/models/'
            '$_geminiModel:generateContent?key=$_geminiKey',
          ),
          headers: {'content-type': 'application/json'},
          body: jsonEncode({
            'contents': [
              {
                'parts': [
                  {
                    'text':
                        'You are a medical translator for the Zimbabwe Ministry '
                        'of Health and Child Care. Translate the following '
                        'de-identified clinical text into $langName. Preserve '
                        'bracketed tokens like ⟦1⟧ exactly and keep ICD-10 '
                        'codes unchanged. Return only the translation.\n\n'
                        '"${m.masked}"',
                  },
                ],
              },
            ],
          }),
        )
        .timeout(const Duration(seconds: 20));
    if (res.statusCode != 200) throw Exception('translate ${res.statusCode}');
    final data = json.decode(res.body) as Map<String, dynamic>;
    final parts = (((data['candidates'] as List).first as Map)['content']
        as Map)['parts'] as List;
    final maskedOut =
        parts.map((p) => (p as Map)['text'].toString()).join().trim();
    return TranslationResult(
      unmaskPii(maskedOut, m.map),
      TranslateSource.provider,
    );
  }
}
