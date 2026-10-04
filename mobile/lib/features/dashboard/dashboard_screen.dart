import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../data/auth_repository.dart';
import '../../data/dds_repository.dart';
import '../../data/models.dart';
import '../../ui/app_shell.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

import '../../l10n/app_localizations.dart';

/// Port of client/src/pages/dashboard.tsx — KPI grid, trend chart,
/// status donut, recent notifications and active alerts.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  DashboardData? _data;
  List<DeathNotification> _recent = const [];
  List<OutbreakAlert> _alerts = const [];
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final repo = context.read<DdsRepository>();
    try {
      final results = await Future.wait([
        repo.dashboard(),
        repo.notifications(),
        repo.alerts(status: 'active'),
      ]);
      if (!mounted) return;
      setState(() {
        _data = results[0] as DashboardData;
        _recent = (results[1] as List<DeathNotification>).take(8).toList();
        _alerts = (results[2] as List<OutbreakAlert>).take(6).toList();
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  int? _pctChange(int current, int prev) {
    if (prev == 0) return current > 0 ? 100 : null;
    return (((current - prev) / prev) * 100).round();
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthRepository>().user;
    final k = _data?.kpis;
    final canCreate =
        user != null &&
        const [
          'medical_officer',
          'public_health_analyst',
          'system_admin',
        ].contains(user.role);

    return AppScaffold(
      title: 'Dashboard',
      actions: [
        if (canCreate)
          IconButton(
            tooltip: tr('New notification'),
            onPressed: () => context.push('/notifications/new'),
            icon: const Icon(Icons.add_circle_outline),
          ),
        IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
      ],
      child: _data == null && _error == null
          ? loadingOr(null)
          : _error != null && _data == null
          ? loadingOr(_error, onRetry: _load)
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  // Welcome banner — mirrors the web header card
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(18),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Wrap(
                            spacing: 10,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              Text(
                                tr('Welcome, {name}', {
                                  'name': user?.name ?? '',
                                }),
                                style: const TextStyle(
                                  fontSize: 19,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 10,
                                  vertical: 3,
                                ),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFECFDF5),
                                  borderRadius: BorderRadius.circular(999),
                                  border: Border.all(
                                    color: const Color(0xFFA7F3D0),
                                  ),
                                ),
                                child: Text(
                                  tr('MOHCC Live'),
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                    color: Color(0xFF047857),
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            tr(
                              'National mortality surveillance and real-time disease detection overview',
                            ),
                            style: TextStyle(
                              fontSize: 12,
                              color: DdsColors.mutedForeground,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  // KPI grid
                  LayoutBuilder(
                    builder: (context, c) {
                      final cols = c.maxWidth > 900
                          ? 3
                          : c.maxWidth > 560
                          ? 2
                          : 2;
                      final kpis = [
                        (
                          'Deaths (7 days)',
                          k?.deathsLast7Days,
                          Icons.monitor_heart_outlined,
                          DdsColors.accentRose,
                          _pctChange(
                            k?.deathsLast7Days ?? 0,
                            k?.deathsPrev7Days ?? 0,
                          ),
                          false,
                        ),
                        (
                          'Pending reviews',
                          k?.pendingReviews,
                          Icons.hourglass_top_outlined,
                          DdsColors.accentAmber,
                          null,
                          false,
                        ),
                        (
                          'Active alerts',
                          k?.activeAlerts,
                          Icons.warning_amber_outlined,
                          DdsColors.accentRed,
                          null,
                          (k?.activeAlerts ?? 0) > 0,
                        ),
                        (
                          'Finalized autopsies',
                          k?.finalizedAutopsies,
                          Icons.fact_check_outlined,
                          DdsColors.accentEmerald,
                          null,
                          false,
                        ),
                        (
                          'MPDSR cases (30d)',
                          k?.mpdsrLast30Days,
                          Icons.child_care_outlined,
                          DdsColors.accentPurple,
                          _pctChange(
                            k?.mpdsrLast30Days ?? 0,
                            k?.mpdsrPrev30Days ?? 0,
                          ),
                          false,
                        ),
                        (
                          'Total notifications',
                          k?.totalNotifications,
                          Icons.assignment_outlined,
                          DdsColors.accentBlue,
                          null,
                          false,
                        ),
                      ];
                      return GridView(
                        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: cols,
                          mainAxisSpacing: 10,
                          crossAxisSpacing: 10,
                          mainAxisExtent: 84,
                        ),
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        children: [
                          for (final kpi in kpis)
                            StatCard(
                              label: kpi.$1,
                              value: kpi.$2,
                              icon: kpi.$3,
                              color: kpi.$4,
                              delta: kpi.$5,
                              pulse: kpi.$6,
                            ),
                        ],
                      );
                    },
                  ),
                  const SizedBox(height: 16),
                  // Charts row 1: mortality trend + status donut (web layout)
                  LayoutBuilder(
                    builder: (context, c) {
                      final wide = c.maxWidth > 820;
                      final trend = SectionCard(
                        title: 'Mortality trend — last 30 days',
                        subtitle: 'Daily notified deaths nationwide',
                        child: SizedBox(
                          height: 240,
                          child: _TrendChart(points: _data!.daily),
                        ),
                      );
                      final donut = SectionCard(
                        title: 'Notification status',
                        subtitle: 'Workflow distribution',
                        child: SizedBox(
                          height: 240,
                          child: _StatusDonut(points: _data!.byStatus),
                        ),
                      );
                      if (wide) {
                        return Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(flex: 2, child: trend),
                            const SizedBox(width: 16),
                            Expanded(child: donut),
                          ],
                        );
                      }
                      return Column(
                        children: [trend, const SizedBox(height: 16), donut],
                      );
                    },
                  ),
                  const SizedBox(height: 16),
                  // Charts row 2: category donut + province bars (web layout)
                  LayoutBuilder(
                    builder: (context, c) {
                      final wide = c.maxWidth > 820;
                      final catDonut = SectionCard(
                        title: 'Deaths by category',
                        subtitle: '90-day share of disease categories',
                        child: SizedBox(
                          height: 240,
                          child: _CategoryDonut(points: _data!.byCategory),
                        ),
                      );
                      final bars = SectionCard(
                        title: 'Deaths by province',
                        subtitle: '90-day distribution across the 10 provinces',
                        child: SizedBox(
                          height: 240,
                          child: _ProvinceBars(points: _data!.byProvince),
                        ),
                      );
                      if (wide) {
                        return Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(child: catDonut),
                            const SizedBox(width: 16),
                            Expanded(flex: 2, child: bars),
                          ],
                        );
                      }
                      return Column(
                        children: [catDonut, const SizedBox(height: 16), bars],
                      );
                    },
                  ),
                  const SizedBox(height: 16),
                  // Recent notifications
                  SectionCard(
                    title: 'Recent death notifications',
                    subtitle:
                        'Latest clinical records reported across facilities',
                    trailing: TextButton(
                      onPressed: () => context.go('/notifications'),
                      child: Text(tr('View all')),
                    ),
                    padding: EdgeInsets.zero,
                    child: Column(
                      children: [
                        for (final n in _recent)
                          ListTile(
                            dense: true,
                            title: Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    n.patientName,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w600,
                                      fontSize: 13,
                                    ),
                                  ),
                                ),
                                if (n.isMaternalPerinatal) ...[
                                  const SizedBox(width: 6),
                                  _mpdsrChip(),
                                ],
                              ],
                            ),
                            subtitle: Text(
                              '${n.preliminaryIcdCode} · ${n.facilityName} · ${fmtDate(n.dateOfDeath)}',
                              style: const TextStyle(fontSize: 11),
                            ),
                            trailing: StatusBadge(n.status),
                            onTap: () => context.push(
                              '/notifications/${n.notificationId}',
                            ),
                          ),
                        if (_recent.isEmpty)
                          const EmptyState('No notifications recorded yet'),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  // Active alerts
                  SectionCard(
                    title: 'Active alerts',
                    subtitle: 'Automated surveillance threshold triggers',
                    trailing: TextButton(
                      onPressed: () => context.go('/alerts'),
                      child: Text(tr('All alerts')),
                    ),
                    child: Column(
                      children: [
                        for (final a in _alerts)
                          Container(
                            margin: const EdgeInsets.only(bottom: 10),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              border: Border.all(color: DdsColors.border),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  mainAxisAlignment:
                                      MainAxisAlignment.spaceBetween,
                                  children: [
                                    Expanded(
                                      child: Text(
                                        a.diseaseCategory,
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w600,
                                          fontSize: 13,
                                        ),
                                      ),
                                    ),
                                    _alertChip(a),
                                  ],
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  '${a.district} · ${tr('{n} case(s)', {'n': a.caseCount})} · ${fmtDate(a.triggeredDate)}',
                                  style: const TextStyle(
                                    fontSize: 11,
                                    color: DdsColors.mutedForeground,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        if (_alerts.isEmpty)
                          const EmptyState('No active outbreak alerts.'),
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

Widget _mpdsrChip() => Container(
  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
  decoration: BoxDecoration(
    color: const Color(0xFFFEE2E2),
    borderRadius: BorderRadius.circular(999),
    border: Border.all(color: const Color(0xFFFCA5A5)),
  ),
  child: Text(
    tr('MPDSR'),
    style: TextStyle(
      fontSize: 10,
      fontWeight: FontWeight.w700,
      color: DdsColors.destructive,
    ),
  ),
);

Widget _alertChip(OutbreakAlert a) => Container(
  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
  decoration: BoxDecoration(
    color: a.alertType == 'mpdsr'
        ? const Color(0xFFF1F5F9)
        : const Color(0xFFFEE2E2),
    borderRadius: BorderRadius.circular(999),
    border: Border.all(
      color: a.alertType == 'mpdsr'
          ? const Color(0xFFCBD5E1)
          : const Color(0xFFFCA5A5),
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
          : DdsColors.destructive,
    ),
  ),
);

/// Area chart port of the web's recharts AreaChart (rose #e11d48).
class _TrendChart extends StatelessWidget {
  const _TrendChart({required this.points});
  final List<CountPoint> points;

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) {
      return const EmptyState('No deaths recorded in the last 30 days');
    }
    return LineChart(
      LineChartData(
        gridData: FlGridData(
          show: true,
          drawVerticalLine: false,
          getDrawingHorizontalLine: (_) => const FlLine(
            color: DdsColors.border,
            strokeWidth: 1,
            dashArray: [3, 3],
          ),
        ),
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
              interval: (points.length / 5).ceilToDouble(),
              getTitlesWidget: (v, _) {
                final i = v.toInt();
                if (i < 0 || i >= points.length) {
                  return const SizedBox.shrink();
                }
                final d = points[i].label;
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
              for (var i = 0; i < points.length; i++)
                FlSpot(i.toDouble(), points[i].count.toDouble()),
            ],
            isCurved: true,
            color: DdsColors.accentRose,
            barWidth: 2.5,
            // drop-shadow under the line — web: drop-shadow(0 4px 5px rose/0.35)
            shadow: Shadow(
              color: DdsColors.accentRose.withValues(alpha: 0.35),
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
                  DdsColors.accentRose.withValues(alpha: 0.35),
                  DdsColors.accentRose.withValues(alpha: 0.02),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Donut builder shared by the two dashboard pies — each slice gets the
/// vertical depth gradient the web builds via DepthDefs.
Widget _donut(List<CountPoint> points, List<String> labels, int colorOffset) {
  final total = points.fold<int>(0, (a, p) => a + p.count);
  return Column(
    children: [
      Expanded(
        child: PieChart(
          PieChartData(
            centerSpaceRadius: 46,
            sectionsSpace: 3,
            sections: [
              for (var i = 0; i < points.length; i++)
                PieChartSectionData(
                  value: points[i].count.toDouble(),
                  gradient: depthGradient(
                    kCategoryColors[(i + colorOffset) % kCategoryColors.length],
                  ),
                  radius: 38,
                  title: total > 0
                      ? '${(points[i].count / total * 100).round()}%'
                      : '',
                  titleStyle: const TextStyle(
                    fontSize: 10,
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    shadows: [Shadow(color: Colors.black38, blurRadius: 2)],
                  ),
                ),
            ],
          ),
        ),
      ),
      const SizedBox(height: 8),
      Wrap(
        spacing: 12,
        runSpacing: 4,
        children: [
          for (var i = 0; i < points.length; i++)
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color:
                        kCategoryColors[(i + colorOffset) %
                            kCategoryColors.length],
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 4),
                Text(
                  '${labels[i]} (${points[i].count})',
                  style: const TextStyle(fontSize: 11),
                ),
              ],
            ),
        ],
      ),
    ],
  );
}

class _StatusDonut extends StatelessWidget {
  const _StatusDonut({required this.points});
  final List<CountPoint> points;

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) return const EmptyState('No data');
    return _donut(
      points,
      [for (final p in points) tr(kStatusLabels[p.label] ?? p.label)],
      3, // web uses (i + 3) % CATEGORY_COLORS.length for the status donut
    );
  }
}

class _CategoryDonut extends StatelessWidget {
  const _CategoryDonut({required this.points});
  final List<CountPoint> points;

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) return const EmptyState('No data');
    return _donut(points, [for (final p in points) tr(p.label)], 0);
  }
}

class _ProvinceBars extends StatelessWidget {
  const _ProvinceBars({required this.points});
  final List<CountPoint> points;

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) return const EmptyState('No data');
    return BarChart(
      BarChartData(
        gridData: FlGridData(
          show: true,
          drawVerticalLine: false,
          getDrawingHorizontalLine: (_) => const FlLine(
            color: DdsColors.border,
            strokeWidth: 1,
            dashArray: [3, 3],
          ),
        ),
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
              getTitlesWidget: (v, _) {
                final i = v.toInt();
                if (i < 0 || i >= points.length) {
                  return const SizedBox.shrink();
                }
                final name = points[i].label;
                // Angled labels — web: angle={-25} textAnchor="end"
                return Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Transform.rotate(
                    angle: -0.44,
                    child: Text(
                      name.length > 9 ? '${name.substring(0, 8)}…' : name,
                      style: const TextStyle(fontSize: 9),
                    ),
                  ),
                );
              },
            ),
          ),
        ),
        barGroups: [
          for (var i = 0; i < points.length; i++)
            BarChartGroupData(
              x: i,
              barRods: [
                BarChartRodData(
                  toY: points[i].count.toDouble(),
                  // sky gradient + rounded top — web: grad("prov",0), radius 5
                  gradient: depthGradient(const Color(0xFF0EA5E9)),
                  width: 18,
                  borderRadius: const BorderRadius.vertical(
                    top: Radius.circular(5),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}
