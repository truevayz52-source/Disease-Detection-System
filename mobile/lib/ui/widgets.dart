import 'dart:io';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../data/api_client.dart';
import '../data/image_cache.dart';
import 'theme.dart';

import '../l10n/app_localizations.dart';

/// Mirrors client/src/lib/format.ts fmtDate / fmtDateTime
String fmtDate(String? iso) {
  if (iso == null || iso.isEmpty) return '—';
  final d = DateTime.tryParse(iso);
  if (d == null) return '—';
  return DateFormat('dd MMM yyyy').format(d.toLocal());
}

String fmtDateTime(String? iso) {
  if (iso == null || iso.isEmpty) return '—';
  final d = DateTime.tryParse(iso);
  if (d == null) return '—';
  return DateFormat('dd MMM yyyy, HH:mm').format(d.toLocal());
}

/// KPI card — port of client/src/components/stat-card.tsx: fully colored
/// gradient card with a 3D finish (gloss top highlight, inner bevel, frosted
/// icon tile, deep colored drop shadow) and optional % delta badge.
class StatCard extends StatelessWidget {
  const StatCard({
    super.key,
    required this.label,
    required this.icon,
    required this.color,
    this.value,
    this.delta,
    this.pulse = false,
    this.compact = false,
  });

  final String label;
  final IconData icon;
  final Color color;
  final int? value;
  final int? delta; // signed % change vs previous period
  final bool pulse;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final text = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (!compact)
          Text(
            tr(label),
            style: TextStyle(
              fontSize: 12,
              color: Colors.white.withValues(alpha: 0.85),
              fontWeight: FontWeight.w600,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        Text(
          value?.toString() ?? '—',
          style: TextStyle(
            fontSize: compact ? 20 : 24,
            fontWeight: FontWeight.bold,
            color: Colors.white,
            shadows: const [
              Shadow(
                color: Colors.black26,
                blurRadius: 3,
                offset: Offset(0, 1),
              ),
            ],
          ),
        ),
        if (compact)
          Text(
            tr(label),
            style: TextStyle(
              fontSize: 12,
              color: Colors.white.withValues(alpha: 0.85),
              fontWeight: FontWeight.w600,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        if (delta != null)
          Padding(
            padding: const EdgeInsets.only(top: 3),
            child: _DeltaBadge(value: delta!),
          ),
      ],
    );

    Widget card = Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [shadeColor(color, 12), shadeColor(color, -22)],
        ),
        boxShadow: [
          BoxShadow(
            color: shadeColor(color, -48).withValues(alpha: 0.45),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.1),
            blurRadius: 5,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Stack(
          fit: StackFit.expand,
          children: [
            // Content
            Padding(
              padding: EdgeInsets.all(compact ? 10 : 12),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Scale text down rather than overflow in fixed-height cells.
                  Expanded(
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: text,
                    ),
                  ),
                  const SizedBox(width: 8),
                  // Frosted glass icon tile
                  Container(
                    width: 32,
                    height: 32,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.25),
                      borderRadius: BorderRadius.circular(8),
                      border: const Border(
                        top: BorderSide(color: Colors.white38),
                      ),
                    ),
                    child: Icon(
                      icon,
                      color: Colors.white,
                      size: 16,
                      shadows: const [
                        Shadow(color: Colors.black26, blurRadius: 4),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            // Gloss: top half fades white → transparent
            IgnorePointer(
              child: FractionallySizedBox(
                alignment: Alignment.topCenter,
                heightFactor: 0.5,
                widthFactor: 1,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        Colors.white.withValues(alpha: 0.25),
                        Colors.transparent,
                      ],
                    ),
                  ),
                ),
              ),
            ),
            // Inner bevel: bright top edge + dark bottom edge
            IgnorePointer(
              child: Align(
                alignment: Alignment.bottomCenter,
                child: Container(
                  height: 10,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.bottomCenter,
                      end: Alignment.topCenter,
                      colors: [
                        Colors.black.withValues(alpha: 0.22),
                        Colors.transparent,
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
    if (pulse) card = _Pulse(child: card);
    return card;
  }
}

/// Whole-card pulse — mirrors `animate-pulse` on the web StatCard.
class _Pulse extends StatefulWidget {
  const _Pulse({required this.child});
  final Widget child;

  @override
  State<_Pulse> createState() => _PulseState();
}

class _PulseState extends State<_Pulse> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FadeTransition(
    opacity: Tween(begin: 0.72, end: 1.0).animate(_c),
    child: widget.child,
  );
}

/// Translucent % delta pill — port of DeltaBadge in stat-card.tsx.
class _DeltaBadge extends StatelessWidget {
  const _DeltaBadge({required this.value});
  final int value;

  @override
  Widget build(BuildContext context) {
    final up = value >= 0;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        // up = "bad" → darker glass; down = good → lighter glass
        color: up
            ? Colors.black.withValues(alpha: 0.25)
            : Colors.white.withValues(alpha: 0.25),
        borderRadius: BorderRadius.circular(999),
        border: const Border(top: BorderSide(color: Colors.white30)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            up ? Icons.trending_up : Icons.trending_down,
            size: 11,
            color: Colors.white,
          ),
          const SizedBox(width: 3),
          Text(
            '${up ? '+' : ''}$value% ${tr('vs prior')}',
            style: const TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              color: Colors.white,
            ),
          ),
        ],
      ),
    );
  }
}

/// Status pill — mirrors the Badge + STATUS_VARIANTS mapping on the web.
class StatusBadge extends StatelessWidget {
  const StatusBadge(this.status, {super.key});

  final String status;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (status) {
      'pending_review' ||
      'active' => (const Color(0xFFFEE2E2), DdsColors.destructive),
      'under_review' => (const Color(0xFFDCFCE7), const Color(0xFF166534)),
      'autopsy_complete' ||
      'draft' => (const Color(0xFFF1F5F9), const Color(0xFF475569)),
      'finalized' || 'resolved' => (Colors.white, const Color(0xFF475569)),
      _ => (const Color(0xFFF1F5F9), const Color(0xFF475569)),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: fg.withValues(alpha: 0.35)),
      ),
      child: Text(
        tr(kStatusLabels[status] ?? status),
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: fg),
      ),
    );
  }
}

/// Card with a bordered header (title + subtitle) — mirrors the web Card.
class SectionCard extends StatelessWidget {
  const SectionCard({
    super.key,
    required this.title,
    this.subtitle,
    this.trailing,
    required this.child,
    this.padding = const EdgeInsets.all(16),
  });

  final String title;
  final String? subtitle;
  final Widget? trailing;
  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: const BoxDecoration(
              color: Color(0xFFF8FAFC),
              border: Border(bottom: BorderSide(color: Color(0xFFF1F5F9))),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        tr(title),
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      if (subtitle != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(
                            tr(subtitle!),
                            style: const TextStyle(
                              fontSize: 11,
                              color: DdsColors.mutedForeground,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                ?trailing,
              ],
            ),
          ),
          Padding(padding: padding, child: child),
        ],
      ),
    );
  }
}

/// Label/value row used in detail screens (mirrors dt/dd grid).
class InfoRow extends StatelessWidget {
  const InfoRow(this.label, this.value, {super.key});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 110,
            child: Text(
              tr(label),
              style: const TextStyle(
                fontSize: 12,
                color: DdsColors.mutedForeground,
              ),
            ),
          ),
          Expanded(child: Text(value, style: const TextStyle(fontSize: 13))),
        ],
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState(this.message, {super.key, this.icon});
  final String message;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null)
              Icon(icon, size: 32, color: DdsColors.mutedForeground),
            const SizedBox(height: 8),
            Text(
              tr(message),
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: DdsColors.mutedForeground,
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Loading / error body shared by list screens.
Widget loadingOr(Object? error, {VoidCallback? onRetry}) {
  if (error == null) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(32),
        child: CircularProgressIndicator(),
      ),
    );
  }
  return Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.cloud_off,
            size: 36,
            color: DdsColors.mutedForeground,
          ),
          const SizedBox(height: 8),
          Text(
            '$error',
            textAlign: TextAlign.center,
            style: const TextStyle(color: DdsColors.mutedForeground),
          ),
          if (onRetry != null) ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh, size: 16),
              label: Text(tr('Retry')),
            ),
          ],
        ],
      ),
    ),
  );
}

/// Tele-pathology image with on-device caching — serves from
/// `<docs>/imgcache` when offline, otherwise downloads and caches. Falls
/// back to a placeholder when neither network nor cache has the image.
class DdsNetImage extends StatefulWidget {
  const DdsNetImage({
    super.key,
    required this.imageId,
    this.fit = BoxFit.cover,
    this.iconColor = Colors.white54,
  });

  final String imageId;
  final BoxFit fit;
  final Color iconColor;

  @override
  State<DdsNetImage> createState() => _DdsNetImageState();
}

class _DdsNetImageState extends State<DdsNetImage> {
  static final _store = ImageCacheStore();
  File? _file;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(DdsNetImage old) {
    super.didUpdateWidget(old);
    if (old.imageId != widget.imageId) _load();
  }

  Future<void> _load() async {
    final api = context.read<ApiClient>();
    final cached = await _store.cachedFile(widget.imageId);
    if (cached != null) {
      if (mounted) setState(() => _file = cached);
      return;
    }
    final fetched = await _store.fetchAndCache(
      widget.imageId,
      api.fileUrl(widget.imageId),
    );
    if (!mounted) return;
    setState(() {
      _file = fetched;
      _failed = fetched == null;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_file != null) {
      return Image.file(
        _file!,
        fit: widget.fit,
        errorBuilder: (c, e, s) => _placeholder(),
      );
    }
    if (_failed) return _placeholder();
    return const Center(
      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white54),
    );
  }

  Widget _placeholder() => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.broken_image, color: widget.iconColor, size: 32),
        const SizedBox(height: 4),
        Text(
          tr('Image requires connection'),
          style: TextStyle(fontSize: 10, color: widget.iconColor),
        ),
      ],
    ),
  );
}
