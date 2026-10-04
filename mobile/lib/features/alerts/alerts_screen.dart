import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/auth_repository.dart';
import '../../data/dds_repository.dart';
import '../../data/models.dart';
import '../../ui/app_shell.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

import '../../l10n/app_localizations.dart';

/// Port of client/src/pages/alerts.tsx — stat cards, status/type filters,
/// alert cards with resolve action (analyst/admin only).
class AlertsScreen extends StatefulWidget {
  const AlertsScreen({super.key});

  @override
  State<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends State<AlertsScreen> {
  List<OutbreakAlert> _items = [];
  AlertStats _stats = const AlertStats();
  bool _loading = true;
  Object? _error;
  String _status = 'all';
  String _type = 'all';
  final Set<String> _resolving = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final repo = context.read<DdsRepository>();
      final results = await Future.wait([
        repo.alerts(status: _status, type: _type),
        repo.alertStats(),
      ]);
      if (mounted) {
        setState(() {
          _items = results[0] as List<OutbreakAlert>;
          _stats = results[1] as AlertStats;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  Future<void> _resolve(OutbreakAlert a) async {
    setState(() => _resolving.add(a.alertId));
    try {
      await context.read<DdsRepository>().resolveAlert(a.alertId);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(tr('Alert resolved.'))));
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _resolving.remove(a.alertId));
    }
  }

  @override
  Widget build(BuildContext context) {
    final role = context.watch<AuthRepository>().user?.role;
    final canResolve = const [
      'public_health_analyst',
      'system_admin',
    ].contains(role);

    return AppScaffold(
      title: 'Alerts',
      actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            SizedBox(
              height: 74,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  _mini(
                    'Active',
                    _stats.active,
                    Icons.warning_amber,
                    DdsColors.accentRed,
                  ),
                  _mini(
                    'Critical',
                    _stats.critical,
                    Icons.error_outline,
                    DdsColors.severityCritical,
                  ),
                  _mini(
                    'High risk',
                    _stats.highRisk,
                    Icons.priority_high,
                    DdsColors.severityHigh,
                  ),
                  _mini(
                    'Active cases',
                    _stats.activeCases,
                    Icons.coronavirus_outlined,
                    DdsColors.accentPurple,
                  ),
                  _mini(
                    'Resolved',
                    _stats.resolved,
                    Icons.check_circle_outline,
                    DdsColors.success,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              children: [
                for (final s in ['all', 'active', 'resolved'])
                  ChoiceChip(
                    label: Text(
                      s == 'all'
                          ? tr('All')
                          : s == 'active'
                          ? tr('Active')
                          : tr('Resolved'),
                    ),
                    selected: _status == s,
                    onSelected: (_) {
                      setState(() => _status = s);
                      _load();
                    },
                  ),
                const SizedBox(width: 8),
                for (final t in ['all', 'outbreak', 'mpdsr'])
                  ChoiceChip(
                    label: Text(
                      t == 'all'
                          ? tr('All types')
                          : t == 'outbreak'
                          ? tr('Outbreak')
                          : 'MPDSR',
                    ),
                    selected: _type == t,
                    onSelected: (_) {
                      setState(() => _type = t);
                      _load();
                    },
                  ),
              ],
            ),
            const SizedBox(height: 12),
            if (_loading)
              loadingOr(null)
            else if (_error != null)
              loadingOr(_error, onRetry: _load)
            else if (_items.isEmpty)
              const Card(child: EmptyState('No alerts match your filters.'))
            else
              for (final a in _items) _alertCard(a, canResolve),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }

  Widget _mini(String label, int value, IconData icon, Color color) =>
      Container(
        width: 140,
        margin: const EdgeInsets.only(right: 10),
        child: StatCard(
          label: label,
          value: value,
          icon: icon,
          color: color,
          compact: true,
        ),
      );

  Widget _alertCard(OutbreakAlert a, bool canResolve) {
    final cluster = _parseCluster(a.clusterData);
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    tr(a.diseaseCategory),
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 15,
                    ),
                  ),
                ),
                StatusBadge(a.status),
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: a.alertType == 'mpdsr'
                        ? const Color(0xFFF1F5F9)
                        : _riskColor(a.riskScore).withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(
                      color: a.alertType == 'mpdsr'
                          ? const Color(0xFFCBD5E1)
                          : _riskColor(a.riskScore).withValues(alpha: 0.4),
                    ),
                  ),
                  child: Text(
                    a.alertType == 'mpdsr'
                        ? 'MPDSR'
                        : tr('Risk {n}', {'n': a.riskScore.toStringAsFixed(0)}),
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: a.alertType == 'mpdsr'
                          ? const Color(0xFF475569)
                          : _riskColor(a.riskScore),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              '${a.district} · ${tr('{n} case(s)', {'n': a.caseCount})} · ${fmtDateTime(a.triggeredDate)}',
              style: const TextStyle(
                fontSize: 12,
                color: DdsColors.mutedForeground,
              ),
            ),
            if (cluster != null) ...[
              const SizedBox(height: 6),
              Text(
                tr('Cluster: {x}', {'x': cluster}),
                style: const TextStyle(
                  fontSize: 11,
                  color: DdsColors.mutedForeground,
                ),
              ),
            ],
            if (a.dispatchedChannels != null &&
                a.dispatchedChannels!.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  tr('Dispatched via: {x}', {'x': a.dispatchedChannels}),
                  style: const TextStyle(
                    fontSize: 11,
                    color: DdsColors.mutedForeground,
                  ),
                ),
              ),
            if (a.resolvedAt != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  tr('Resolved {ts}', {'ts': fmtDateTime(a.resolvedAt)}),
                  style: const TextStyle(
                    fontSize: 11,
                    color: DdsColors.success,
                  ),
                ),
              ),
            if (a.status == 'active' && canResolve)
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: _resolving.contains(a.alertId)
                      ? null
                      : () => _resolve(a),
                  icon: _resolving.contains(a.alertId)
                      ? const SizedBox(
                          width: 12,
                          height: 12,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.check_circle_outline, size: 16),
                  label: Text(tr('Resolve')),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Color _riskColor(double score) => score >= 75
      ? DdsColors.severityCritical
      : score >= 50
      ? DdsColors.severityHigh
      : DdsColors.severityLow;

  String? _parseCluster(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    try {
      final d = jsonDecode(raw);
      if (d is Map) {
        return [
          if (d['radius_km'] != null) tr('radius {n}km', {'n': d['radius_km']}),
          if (d['centroid'] != null) tr('centroid {c}', {'c': d['centroid']}),
        ].join(', ');
      }
      return raw;
    } catch (_) {
      return raw;
    }
  }
}
