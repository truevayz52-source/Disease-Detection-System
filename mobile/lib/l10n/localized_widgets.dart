/// Automatic UI localisation for literal widget text — the mobile
/// counterpart of the web client's DOM localiser
/// (client/src/lib/dom-localize.ts).
///
/// Drop-in shadows for the widget types that carry literal strings: [Text]
/// (including [Text.rich] / [TextSpan]) and [InputDecoration] string
/// attributes (label, hint, helper, error, prefix, suffix and counter text).
/// Values with no dictionary entry pass through unchanged, so entered data,
/// names, IDs and technical values are never touched — the same guarantee
/// the DOM localiser gives the web client.
///
/// A screen opts in by hiding the material names and importing this file:
///
/// ```dart
/// import 'package:flutter/material.dart' hide InputDecoration, Text, TextSpan;
/// import 'package:dds_mobile/l10n/localized_widgets.dart';
/// ```
///
/// Lookup runs through the same `tr()` dictionaries as explicit call sites
/// (assets/lang/<code>.json + the /api/i18n overlay), and every widget is
/// rebuilt on language switch, so literals pick up the active language
/// automatically — no per-site wiring. `InputDecoration.collapsed` is not
/// shadowed; construct it via the default constructor.
library;

import 'package:flutter/material.dart' as m;
import 'app_localizations.dart';

/// Recursively rewrites a span tree, translating every [m.TextSpan] text
/// that has a dictionary entry. Recognisers, styles and non-text spans
/// (WidgetSpan & co.) pass through untouched.
m.InlineSpan _localizeInlineSpan(m.InlineSpan span) {
  if (span is TextSpan) return span; // already localised
  if (span is! m.TextSpan) return span;
  return TextSpan(
    text: span.text,
    children: span.children,
    style: span.style,
    recognizer: span.recognizer,
    mouseCursor: span.mouseCursor,
    onEnter: span.onEnter,
    onExit: span.onExit,
    semanticsLabel: span.semanticsLabel,
    semanticsIdentifier: span.semanticsIdentifier,
    locale: span.locale,
    spellOut: span.spellOut,
  );
}

/// [m.Text] shadow — translates [data] through `tr()` at construction.
class Text extends m.Text {
  Text(
    String data, {
    super.key,
    super.style,
    super.strutStyle,
    super.textAlign,
    super.textDirection,
    super.locale,
    super.softWrap,
    super.overflow,
    super.textScaler,
    super.maxLines,
    super.semanticsLabel,
    super.semanticsIdentifier,
    super.textWidthBasis,
    super.textHeightBehavior,
    super.selectionColor,
  }) : super(
         tr(data),
       );

  Text.rich(
    m.InlineSpan textSpan, {
    super.key,
    super.style,
    super.strutStyle,
    super.textAlign,
    super.textDirection,
    super.locale,
    super.softWrap,
    super.overflow,
    super.textScaler,
    super.maxLines,
    super.semanticsLabel,
    super.semanticsIdentifier,
    super.textWidthBasis,
    super.textHeightBehavior,
    super.selectionColor,
  }) : super.rich(
         _localizeInlineSpan(textSpan),
       );
}

/// [m.TextSpan] shadow — translates [text] and every descendant span.
class TextSpan extends m.TextSpan {
  TextSpan({
    super.style,
    String? text,
    List<m.InlineSpan>? children,
    super.recognizer,
    super.mouseCursor,
    super.onEnter,
    super.onExit,
    super.semanticsLabel,
    super.semanticsIdentifier,
    super.locale,
    super.spellOut,
  }) : super(
         text: text == null ? null : tr(text),
         children: children?.map(_localizeInlineSpan).toList(),
       );
}

/// [m.InputDecoration] shadow — translates the free-text attributes
/// (label, hint, helper, error, prefix, suffix, counter and semantic
/// counter text); widget slots pass through untouched.
class InputDecoration extends m.InputDecoration {
  InputDecoration({
    super.icon,
    super.iconColor,
    super.label,
    String? labelText,
    super.labelStyle,
    super.floatingLabelStyle,
    super.helper,
    String? helperText,
    super.helperStyle,
    super.helperMaxLines,
    String? hintText,
    super.hint,
    super.hintStyle,
    super.hintTextDirection,
    super.hintMaxLines,
    super.hintFadeDuration,
    super.maintainHintHeight,
    super.maintainHintSize,
    super.maintainLabelSize,
    super.error,
    String? errorText,
    super.errorStyle,
    super.errorMaxLines,
    super.floatingLabelBehavior,
    super.floatingLabelAlignment,
    super.isDense,
    super.contentPadding,
    super.isCollapsed,
    super.prefixIcon,
    super.prefixIconConstraints,
    super.prefix,
    String? prefixText,
    super.prefixStyle,
    super.prefixIconColor,
    super.suffixIcon,
    super.suffix,
    String? suffixText,
    super.suffixStyle,
    super.suffixIconColor,
    super.suffixIconConstraints,
    String? counterText,
    super.counter,
    super.counterStyle,
    super.filled,
    super.fillColor,
    super.focusColor,
    super.hoverColor,
    super.errorBorder,
    super.focusedBorder,
    super.focusedErrorBorder,
    super.disabledBorder,
    super.enabledBorder,
    super.border,
    super.enabled,
    String? semanticCounterText,
    super.alignLabelWithHint,
    super.constraints,
    super.visualDensity,
  }) : super(
         labelText: labelText == null ? null : tr(labelText),
         helperText: helperText == null ? null : tr(helperText),
         hintText: hintText == null ? null : tr(hintText),
         errorText: errorText == null ? null : tr(errorText),
         prefixText: prefixText == null ? null : tr(prefixText),
         suffixText: suffixText == null ? null : tr(suffixText),
         counterText: counterText == null ? null : tr(counterText),
         semanticCounterText: semanticCounterText == null
             ? null
             : tr(semanticCounterText),
       );
}
