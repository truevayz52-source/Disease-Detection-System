import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/dds_repository.dart';
import '../data/deidentify.dart';
import '../l10n/app_localizations.dart';
import '../l10n/language_provider.dart';
import 'theme.dart';

/// "Summarise with AI" — posts masked clinical text to POST /api/ai/summarize
/// and renders the draft with a verify badge (same convention as TranslatedText).
/// PII literals become ⟦n⟧ tokens before the request leaves the device; the
/// server's privacy gate masks again and re-checks before the provider call.
class AiSummary extends StatefulWidget {
  const AiSummary(this.text, {super.key, this.pii = const []});

  final String text;
  final List<String> pii;

  @override
  State<AiSummary> createState() => _AiSummaryState();
}

class _AiSummaryState extends State<AiSummary> {
  String? _summary;
  bool _pending = false;

  Future<void> _run() async {
    setState(() => _pending = true);
    try {
      final lang = context.read<LanguageProvider>().code;
      final m = maskPii(widget.text, widget.pii);
      final res = await context.read<DdsRepository>().aiSummarize(
        m.masked,
        widget.pii,
        lang,
      );
      if (!mounted) return;
      setState(() => _summary = unmaskPii(res, m.map));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.tr('AI summarisation failed'))),
        );
      }
    } finally {
      if (mounted) setState(() => _pending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.text.trim().isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (_summary == null)
          TextButton.icon(
            style: TextButton.styleFrom(
              padding: EdgeInsets.zero,
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              visualDensity: VisualDensity.compact,
            ),
            onPressed: _pending ? null : _run,
            icon: Icon(
              _pending ? Icons.hourglass_top : Icons.auto_awesome,
              size: 14,
              color: DdsColors.primary,
            ),
            label: Text(
              tr(_pending ? 'Summarising…' : 'Summarise with AI'),
              style: TextStyle(fontSize: 11, color: DdsColors.primary),
            ),
          ),
        if (_summary != null)
          Container(
            margin: const EdgeInsets.only(top: 6),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              border: Border.all(
                color: DdsColors.border,
                style: BorderStyle.solid,
              ),
              borderRadius: BorderRadius.circular(8),
              color: DdsColors.muted.withValues(alpha: 0.3),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(_summary!, style: const TextStyle(fontSize: 13)),
                const SizedBox(height: 6),
                Row(
                  children: [
                    const Icon(
                      Icons.auto_awesome,
                      size: 11,
                      color: DdsColors.mutedForeground,
                    ),
                    const SizedBox(width: 4),
                    Expanded(
                      child: Text(
                        tr(
                          'AI-generated draft — verify against the record before use',
                        ),
                        style: const TextStyle(
                          fontSize: 10,
                          color: DdsColors.mutedForeground,
                        ),
                      ),
                    ),
                    GestureDetector(
                      onTap: () => setState(() => _summary = null),
                      child: Text(
                        tr('Dismiss'),
                        style: const TextStyle(
                          fontSize: 10,
                          color: DdsColors.mutedForeground,
                          decoration: TextDecoration.underline,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
      ],
    );
  }
}
