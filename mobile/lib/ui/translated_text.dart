import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/translation_service.dart';
import '../l10n/app_localizations.dart';
import '../l10n/language_provider.dart';
import 'theme.dart';

/// Renders clinical record text with an optional translate toggle.
/// Machine translations are always labelled and never replace the source.
class TranslatedText extends StatefulWidget {
  const TranslatedText(this.text, {super.key, this.pii = const [], this.style});

  /// The source clinical text (e.g. autopsy findings).
  final String text;

  /// PII literals from the record (names, IDs, facility) — masked before any
  /// external call.
  final List<String> pii;

  final TextStyle? style;

  @override
  State<TranslatedText> createState() => _TranslatedTextState();
}

class _TranslatedTextState extends State<TranslatedText> {
  TranslationResult? _result;
  bool _translating = false;
  bool _showOriginal = false;

  @override
  Widget build(BuildContext context) {
    final lang = context.watch<LanguageProvider>();
    final canTranslate = !lang.isEnglish && !lang.isSignLanguage;

    final text = widget.text;
    final showingTranslated =
        _result != null &&
        _result!.source != TranslateSource.original &&
        !_showOriginal;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          showingTranslated ? _result!.text : text,
          style: widget.style ?? const TextStyle(fontSize: 13),
        ),
        if (canTranslate) ...[
          const SizedBox(height: 4),
          Wrap(
            spacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (_result == null || _showOriginal)
                TextButton.icon(
                  style: TextButton.styleFrom(
                    padding: EdgeInsets.zero,
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  onPressed: _translating ? null : _translate,
                  icon: const Icon(Icons.translate, size: 14),
                  label: Text(
                    _translating
                        ? tr('Translating…')
                        : tr('Translate to {lang}', {
                            'lang': languageInfo(lang.code).nativeName,
                          }),
                    style: const TextStyle(fontSize: 12),
                  ),
                ),
              if (showingTranslated) ...[
                Text(
                  _result!.source == TranslateSource.glossary
                      ? tr('Offline glossary translation — verify clinically.')
                      : tr('Machine translation — verify clinically.'),
                  style: const TextStyle(
                    fontSize: 11,
                    fontStyle: FontStyle.italic,
                    color: DdsColors.accentAmber,
                  ),
                ),
                TextButton(
                  style: TextButton.styleFrom(
                    padding: EdgeInsets.zero,
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  onPressed: () => setState(() => _showOriginal = true),
                  child: Text(
                    tr('Show original'),
                    style: const TextStyle(fontSize: 12),
                  ),
                ),
              ],
              if (_result?.source == TranslateSource.original &&
                  _result != null &&
                  !_translating)
                Text(
                  tr('Translation unavailable — showing original.'),
                  style: const TextStyle(
                    fontSize: 11,
                    fontStyle: FontStyle.italic,
                    color: DdsColors.mutedForeground,
                  ),
                ),
            ],
          ),
        ],
      ],
    );
  }

  Future<void> _translate() async {
    setState(() => _translating = true);
    try {
      final svc = context.read<TranslationService>();
      final lang = context.read<LanguageProvider>().code;
      final res = await svc.translate(widget.text, lang, pii: widget.pii);
      if (mounted) {
        setState(() {
          _result = res;
          _showOriginal = res.source == TranslateSource.original;
        });
      }
    } finally {
      if (mounted) setState(() => _translating = false);
    }
  }
}
