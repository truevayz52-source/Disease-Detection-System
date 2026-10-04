import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/dds_repository.dart';
import '../../data/models.dart';
import '../../ui/app_shell.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

import '../../l10n/app_localizations.dart';

/// Port of client/src/pages/analytics.tsx — weekly trend + forecast,
/// detected clusters, and the run-detection action.
class AnalyticsScreen extends StatefulWidget {
  const AnalyticsScreen({super.key});

  @override
  State<AnalyticsScreen> createState() => _AnalyticsScreenState();
}

class _AnalyticsScreenState extends State<AnalyticsScreen> {
  Map<String, dynamic>? _trends;
  List<Cluster> _clusters = const [];
  String? _engine;
  Object? _error;
  bool _detecting = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final repo = context.read<DdsRepository>();
    try {
      final results = await Future.wait([
        repo.trends(weeks: 12),
        repo.clusters(),
        repo.engine(),
      ]);
      if (!mounted) return;
      setState(() {
        _trends = results[0] as Map<String, dynamic>;
        _clusters = results[1] as List<Cluster>;
        _engine = results[2] as String;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _detect() async {
    setState(() => _detecting = true);
    try {
      final created = await context.read<DdsRepository>().detectOutbreaks();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              created > 0
                  ? tr('{n} new outbreak alert(s) created.', {'n': created})
                  : tr('Detection complete — no new clusters.'),
            ),
          ),
        );
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _detecting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Outbreak Analytics',
      actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      child: _trends == null && _error == null
          ? loadingOr(null)
          : _error != null
          ? loadingOr(_error, onRetry: _load)
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          tr('Engine: {e}', {
                            'e': _engine == 'python-sklearn'
                                ? 'Python scikit-learn'
                                : tr('Node fallback'),
                          }),
                          style: const TextStyle(
                            fontSize: 12,
                            color: DdsColors.mutedForeground,
                          ),
                        ),
                      ),
                      FilledButton.icon(
                        onPressed: _detecting ? null : _detect,
                        icon: _detecting
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Icon(Icons.radar, size: 16),
                        label: Text(tr('Detect now')),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  SectionCard(
                    title: 'Weekly mortality trend',
                    subtitle: '12-week totals with 4-week forecast',
                    child: SizedBox(
                      height: 220,
                      child: _WeeklyChart(trends: _trends!),
                    ),
                  ),
                  const SizedBox(height: 16),
                  SectionCard(
                    title: 'Detected clusters',
                    subtitle: 'Spatial groupings in the last 90 days',
                    padding: EdgeInsets.zero,
                    child: _clusters.isEmpty
                        ? const EmptyState('No clusters detected.')
                        : Column(
                            children: [
                              for (final c in _clusters)
                                ListTile(
                                  dense: true,
                                  leading: CircleAvatar(
                                    radius: 16,
                                    backgroundColor: DdsColors.accentRose
                                        .withValues(alpha: 0.12),
                                    child: Text(
                                      '${c.count}',
                                      style: const TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.bold,
                                        color: DdsColors.accentRose,
                                      ),
                                    ),
                                  ),
                                  title: Text(
                                    tr(c.category),
                                    style: const TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  subtitle: Text(
                                    '${c.district ?? ''}${c.province != null ? ', ${c.province}' : ''} · ${c.source}',
                                    style: const TextStyle(fontSize: 11),
                                  ),
                                  isThreeLine: false,
                                ),
                            ],
                          ),
                  ),
                  const SizedBox(height: 24),
                ],
              ),
            ),
    );
  }
}

class _WeeklyChart extends StatelessWidget {
  const _WeeklyChart({required this.trends});
  final Map<String, dynamic> trends;

  @override
  Widget build(BuildContext context) {
    final series = ((trends['series'] as List?) ?? [])
        .map(
          (e) => CountPoint(
            (e as Map)['week']?.toString() ?? '',
            (e['count'] as num).toInt(),
          ),
        )
        .toList();
    final forecast = ((trends['forecast'] as List?) ?? [])
        .map(
          (e) => CountPoint(
            (e as Map)['week']?.toString() ?? '',
            (e['predicted'] as num).toInt(),
          ),
        )
        .toList();
    if (series.isEmpty) return const EmptyState('No trend data');

    final all = [...series, ...forecast];
    return LineChart(
      LineChartData(
        gridData: const FlGridData(show: true, drawVerticalLine: false),
        borderData: FlBorderData(show: false),
        titlesData: FlTitlesData(
          topTitles: const AxisTitles(
            sideTitles: SideTitles(showTitles: false),
          ),
          rightTitles: const AxisTitles(
            sideTitles: SideTitles(showTitles: false),
          ),
          leftTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 30,
              getTitlesWidget: (v, _) => Text(
                v.toInt().toString(),
                style: const TextStyle(fontSize: 10),
              ),
            ),
          ),
          bottomTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              interval: (all.length / 5).ceilToDouble(),
              getTitlesWidget: (v, _) {
                final i = v.toInt();
                if (i < 0 || i >= all.length) {
                  return const SizedBox.shrink();
                }
                final d = all[i].label;
                return Text(
                  d.length >= 10 ? d.substring(5) : d,
                  style: const TextStyle(fontSize: 9),
                );
              },
            ),
          ),
        ),
        lineBarsData: [
          LineChartBarData(
            spots: [
              for (var i = 0; i < series.length; i++)
                FlSpot(i.toDouble(), series[i].count.toDouble()),
            ],
            isCurved: true,
            color: DdsColors.primary,
            barWidth: 2.5,
            shadow: Shadow(
              color: DdsColors.primary.withValues(alpha: 0.35),
              blurRadius: 5,
              offset: const Offset(0, 4),
            ),
            dotData: const FlDotData(show: false),
            belowBarData: BarAreaData(
              show: true,
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  DdsColors.primary.withValues(alpha: 0.3),
                  DdsColors.primary.withValues(alpha: 0.02),
                ],
              ),
            ),
          ),
          if (forecast.isNotEmpty)
            LineChartBarData(
              spots: [
                for (var i = 0; i < forecast.length; i++)
                  FlSpot(
                    (series.length - 1 + i).toDouble(),
                    forecast[i].count.toDouble(),
                  ),
              ],
              isCurved: true,
              color: DdsColors.accentAmber,
              barWidth: 2,
              dashArray: [6, 4],
              dotData: const FlDotData(show: false),
            ),
        ],
      ),
    );
  }
}
