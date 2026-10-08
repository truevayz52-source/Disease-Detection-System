import 'package:flutter/cupertino.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Fallback localizations for languages Flutter doesn't ship resources for.
///
/// Most of the 16 official Zimbabwean languages (nd, sbn, kck, huc, nmq,
/// ndc, toi, ts, ve, zsl — and in this SDK even sn) have no Material,
/// Cupertino or Widgets translations. Without these delegates, switching to
/// one of those locales leaves `MaterialLocalizations`/`WidgetsLocalizations`
/// absent and every Scaffold/Drawer/Tooltip throws "No MaterialLocalizations
/// found".
///
/// Each delegate serves the built-in English implementation for ANY locale.
/// In `localizationsDelegates` they must come BEFORE the Global* delegates:
/// where a real translation exists (en, ny, st, xh, …) the Global delegate
/// wins because later entries override earlier ones per resource type.

class _FallbackMaterialLocalizationsDelegate
    extends LocalizationsDelegate<MaterialLocalizations> {
  const _FallbackMaterialLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) => true;

  @override
  Future<MaterialLocalizations> load(Locale locale) =>
      SynchronousFuture<MaterialLocalizations>(
        const DefaultMaterialLocalizations(),
      );

  @override
  bool shouldReload(_FallbackMaterialLocalizationsDelegate old) => false;
}

class _FallbackWidgetsLocalizationsDelegate
    extends LocalizationsDelegate<WidgetsLocalizations> {
  const _FallbackWidgetsLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) => true;

  @override
  Future<WidgetsLocalizations> load(Locale locale) =>
      SynchronousFuture<WidgetsLocalizations>(
        const DefaultWidgetsLocalizations(),
      );

  @override
  bool shouldReload(_FallbackWidgetsLocalizationsDelegate old) => false;
}

class _FallbackCupertinoLocalizationsDelegate
    extends LocalizationsDelegate<CupertinoLocalizations> {
  const _FallbackCupertinoLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) => true;

  @override
  Future<CupertinoLocalizations> load(Locale locale) =>
      SynchronousFuture<CupertinoLocalizations>(
        const DefaultCupertinoLocalizations(),
      );

  @override
  bool shouldReload(_FallbackCupertinoLocalizationsDelegate old) => false;
}

const fallbackMaterialLocalizations = _FallbackMaterialLocalizationsDelegate();
const fallbackWidgetsLocalizations = _FallbackWidgetsLocalizationsDelegate();
const fallbackCupertinoLocalizations =
    _FallbackCupertinoLocalizationsDelegate();
