import 'package:flutter/material.dart';

/// DDS design tokens — mobile port of client/src/index.css (light theme).
class DdsColors {
  DdsColors._();

  static const primary = Color(0xFF166534); // oklch(0.44 0.145 145)
  static const primaryForeground = Colors.white;
  static const background = Color(0xFFFAFBFC); // oklch(0.99 0.003 220)
  static const foreground = Color(0xFF1F2937); // oklch(0.22 0.03 240)
  static const card = Colors.white;
  static const muted = Color(0xFFF3F4F6);
  static const mutedForeground = Color(0xFF6B7280);
  static const border = Color(0xFFE5E7EB);
  static const destructive = Color(0xFFDC2626);

  // Sidebar (oklch(0.18 0.045 245) ≈ the web manifest theme-color)
  static const sidebar = Color(0xFF1C2733);
  static const sidebarForeground = Color(0xFFF5F7FA);
  static const sidebarPrimary = Color(0xFF16A34A);

  // Brand accents
  static const heroBg = Color(0xFF02180D);
  static const emerald = Color(0xFF34D399);
  static const linkBlue = Color(0xFF2563EB);

  // Severity scale (matches --severity-* tokens)
  static const severityCritical = Color(0xFFDC2626);
  static const severityHigh = Color(0xFFD97706);
  static const severityMedium = Color(0xFFCA8A04);
  static const severityLow = Color(0xFF0D9488);
  static const success = Color(0xFF059669);

  // KPI accent colors used by the web dashboard stat cards
  static const accentRose = Color(0xFFE11D48);
  static const accentAmber = Color(0xFFF59E0B);
  static const accentRed = Color(0xFFEF4444);
  static const accentEmerald = Color(0xFF10B981);
  static const accentPurple = Color(0xFF8B5CF6);
  static const accentBlue = Color(0xFF0EA5E9);
}

/// Port of client/src/components/chart-3d.tsx `shade()` — lighten (+) or
/// darken (−) a color by pct (0–100). Powers the 3D gradients on cards/charts.
Color shadeColor(Color c, int pct) {
  final amt = (2.55 * pct).round();
  int ch(double v) => (v * 255 + amt).round().clamp(0, 255);
  return Color.fromARGB(255, ch(c.r), ch(c.g), ch(c.b));
}

/// Vertical gradient used for the "3D" chart series (light top → dark bottom),
/// matching DepthDefs in chart-3d.tsx.
LinearGradient depthGradient(Color c, {bool horizontal = false}) =>
    LinearGradient(
      begin: horizontal ? Alignment.centerLeft : Alignment.topCenter,
      end: horizontal ? Alignment.centerRight : Alignment.bottomCenter,
      colors: [shadeColor(c, 18), c, shadeColor(c, -22)],
      stops: const [0.0, 0.55, 1.0],
    );

/// Chart palette — mirrors CATEGORY_COLORS in the web dashboard.
const kCategoryColors = [
  Color(0xFFE11D48),
  Color(0xFFF59E0B),
  Color(0xFF8B5CF6),
  Color(0xFF0EA5E9),
  Color(0xFF10B981),
  Color(0xFFF97316),
  Color(0xFF64748B),
  Color(0xFFD946EF),
];

/// Mirrors STATUS_LABELS in client/src/lib/format.ts
const kStatusLabels = {
  'pending_review': 'Pending review',
  'under_review': 'Under review',
  'autopsy_complete': 'Autopsy complete',
  'finalized': 'Finalized',
  'active': 'Active',
  'resolved': 'Resolved',
  'draft': 'Draft',
};

ThemeData ddsTheme() {
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: DdsColors.primary,
      primary: DdsColors.primary,
      surface: DdsColors.background,
      error: DdsColors.destructive,
    ),
    scaffoldBackgroundColor: DdsColors.background,
  );
  return base.copyWith(
    appBarTheme: const AppBarTheme(
      backgroundColor: DdsColors.sidebar,
      foregroundColor: Colors.white,
      elevation: 0,
    ),
    cardTheme: CardThemeData(
      color: DdsColors.card,
      elevation: 5,
      shadowColor: Colors.black38,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: DdsColors.border.withValues(alpha: 0.9)),
      ),
      margin: EdgeInsets.zero,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: Color(0xFF94A3B8)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: DdsColors.linkBlue, width: 2),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: DdsColors.primary,
        foregroundColor: Colors.white,
        minimumSize: const Size(64, 42),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
  );
}
