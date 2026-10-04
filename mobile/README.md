# DDS Mobile (Flutter)

Flutter client for the Disease Detection System — the same Express REST API as
the web client, with offline draft capture and sync.

## Run

```bash
cd mobile
flutter pub get
flutter run                                    # desktop/web → localhost:4000
flutter run -d android                         # emulator → 10.0.2.2:4000
flutter run --dart-define DDS_API_URL=http://<host>:4000/api   # physical device
```

Start the API first (`pnpm dev:server` at the repo root).

## Localization

All 16 official Zimbabwean languages are supported — see
`../i18n/README.md` for the language table and dictionary workflow.

- `lib/l10n/app_localizations.dart` — `tr('English literal')` lookup with
  English fallback (no raw keys).
- `lib/l10n/language_provider.dart` — persists `dds_locale`, adopts
  `user.language` on session restore, and pushes changes via
  `PATCH /user/profile` when signed in.
- Language selector: globe menu in every `AppScaffold` app bar plus a row in
  the profile screen. Selecting ZSL shows an in-app notice (signed video is a
  planned module; text stays English).
- Dictionary assets live in `assets/lang/<code>.json` — regenerated from the
  canonical `i18n/lang/` via `pnpm i18n:sync` at the repo root.

## Dynamic clinical-text translation

`lib/data/translation_service.dart` + `lib/ui/translated_text.dart` translate
narrative fields (clinical summary, autopsy findings, toxicology results,
transcripts) into the active language:

1. `deidentify.dart` masks PII (names, national IDs, phones, coordinates) with
   `⟦n⟧` placeholders before any network call, then re-substitutes.
2. `POST /api/translate` (server holds the provider key — never bundled).
3. Optional direct-Gemini fallback when built with
   `flutter run --dart-define DDS_TRANSLATE_KEY=…` (still de-identified).
4. Offline: `assets/lang/medical-glossary.json` term substitution, else the
   original text — record viewing never blocks.

Machine-translated text renders with a "verify clinically" marker and a
show-original toggle.
