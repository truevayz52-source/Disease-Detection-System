import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/api_client.dart';
import '../l10n/app_localizations.dart';
import '../l10n/language_provider.dart';
import 'theme.dart';

/// Globe menu listing all 16 official Zimbabwean languages. Instant switch —
/// the provider notifies MaterialApp which rebuilds with the new locale.
/// Mounted in every AppScaffold app bar and on the profile screen.
class LanguageMenuButton extends StatelessWidget {
  const LanguageMenuButton({super.key});

  @override
  Widget build(BuildContext context) {
    final lang = context.watch<LanguageProvider>();
    return PopupMenuButton<String>(
      icon: const Icon(Icons.translate),
      tooltip: context.tr('Language'),
      onSelected: (code) => context.read<LanguageProvider>().setLanguage(
        code,
        api: context.read<ApiClient>(),
      ),
      itemBuilder: (context) => [
        for (final l in kLanguages)
          PopupMenuItem<String>(
            value: l.code,
            child: Row(
              children: [
                Icon(
                  lang.code == l.code ? Icons.check : null,
                  size: 18,
                  color: DdsColors.primary,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(l.nativeName, style: const TextStyle(fontSize: 14)),
                      if (l.code != 'en')
                        Text(
                          l.written
                              ? l.name
                              : context.tr(
                                  'Signed video guidance is a planned module',
                                ),
                          style: const TextStyle(
                            fontSize: 11,
                            color: DdsColors.mutedForeground,
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
