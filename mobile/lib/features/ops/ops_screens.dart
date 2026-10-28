import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../data/api_client.dart';
import '../../data/mutation_service.dart';
import '../../l10n/app_localizations.dart';
import '../../ui/app_shell.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// Shared action runner: await fn, snackbar ok/error.
Future<void> _run(
  BuildContext context,
  Future<dynamic> Function() fn,
  String ok,
) async {
  try {
    await fn();
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(tr(ok))));
    }
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }
}

Widget _rowTable(List<dynamic> items, List<String> columns) => Column(
  children: [
    for (final it in items.cast<Map<String, dynamic>>())
      Card(
        margin: const EdgeInsets.only(bottom: 10),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            children: [
              for (var i = 0; i < columns.length; i += 2)
                InfoRow(tr(columns[i + 1]), _cell(it[columns[i]])),
            ],
          ),
        ),
      ),
  ],
);

String _cell(dynamic v) {
  if (v == null) return '—';
  final s = '$v';
  // ISO-ish timestamps get friendly formatting.
  if (RegExp(r'^\d{4}-\d{2}-\d{2}[T ]').hasMatch(s)) return fmtDateTime(s);
  return s;
}

/// Resource forecasting — historical-rate baseline for notifications.
/// Port of ForecastPage in client/src/pages/operations.tsx.
class ForecastScreen extends StatefulWidget {
  const ForecastScreen({super.key});

  @override
  State<ForecastScreen> createState() => _ForecastScreenState();
}

class _ForecastScreenState extends State<ForecastScreen> {
  final _days = TextEditingController(text: '7');
  List<dynamic> _items = [];
  bool _loading = true;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _days.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await context.read<ApiClient>().get('/forecasts');
      if (mounted) {
        setState(() {
          _items = (res['items'] as List?) ?? [];
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

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: tr('Resource Forecasting'),
      actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              tr(
                'Historical-rate baseline for expected death notifications. This is not a validated infection forecast or medical supply recommendation.',
              ),
              style: const TextStyle(
                fontSize: 12,
                color: DdsColors.mutedForeground,
              ),
            ),
            const SizedBox(height: 12),
            SectionCard(
              title: tr('Generate a planning baseline'),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _days,
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(
                      labelText: tr('Forecast horizon (1–30 days)'),
                    ),
                  ),
                  const SizedBox(height: 10),
                  FilledButton(
                    onPressed: () => _run(context, () async {
                      throwIfFailed(
                        await context.read<MutationService>().http(
                          'POST',
                          '/forecasts/generate',
                          body: {'days': int.tryParse(_days.text) ?? 7},
                        ),
                      );
                      await _load();
                    }, 'Baseline generated'),
                    child: Text(tr('Generate baseline')),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            if (_loading)
              loadingOr(null)
            else if (_error != null)
              loadingOr(_error, onRetry: _load)
            else if (_items.isEmpty)
              Card(child: EmptyState(tr('No baselines generated yet.')))
            else
              _rowTable(_items, [
                'district',
                'District',
                'disease_category',
                'Category',
                'forecast_horizon_days',
                'Days',
                'predicted_cases',
                'Expected notifications',
                'forecast_generated_at',
                'Generated',
              ]),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }
}

/// Reports — aggregate export + scheduled reports.
/// Port of ReportsPage + ScheduledReports in operations.tsx/scheduled-reports.tsx.
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  final _days = TextEditingController(text: '30');
  final _name = TextEditingController();
  final _schedDays = TextEditingController(text: '30');
  String _interval = '24';
  bool _email = false;
  bool _busy = false;
  List<dynamic> _schedules = [];
  List<dynamic> _runs = [];
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _days.dispose();
    _name.dispose();
    _schedDays.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final api = context.read<ApiClient>();
      final results = await Future.wait([
        api.get('/reports/scheduled'),
        api.get('/reports/runs'),
      ]);
      if (mounted) {
        setState(() {
          _schedules = (results[0]['items'] as List?) ?? [];
          _runs = (results[1]['items'] as List?) ?? [];
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  /// POST /reports/generate → save the body to a temp file → share sheet
  /// (the mobile equivalent of the browser download).
  Future<void> _download(String format) async {
    setState(() => _busy = true);
    try {
      final api = context.read<ApiClient>();
      final result = await api.post(
        '/reports/generate',
        body: {'days': int.tryParse(_days.text) ?? 30, 'format': format},
      );
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/dds-mortality.$format');
      await file.writeAsString(
        format == 'json'
            ? const JsonEncoder.withIndent('  ').convert(result)
            : result.toString(),
      );
      await SharePlus.instance.share(
        ShareParams(files: [XFile(file.path)], text: 'dds-mortality.$format'),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: tr('Reports'),
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              tr(
                'Export aggregate district mortality data. Every export is recorded in the audit trail.',
              ),
              style: const TextStyle(
                fontSize: 12,
                color: DdsColors.mutedForeground,
              ),
            ),
            const SizedBox(height: 12),
            SectionCard(
              title: tr('District mortality summary'),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _days,
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(
                      labelText: tr('Reporting window (days)'),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: FilledButton(
                          onPressed: _busy ? null : () => _download('csv'),
                          child: Text(tr('Download CSV')),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton(
                          onPressed: _busy ? null : () => _download('json'),
                          child: Text(tr('Download JSON')),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(
                    tr(
                      'Exports open the share sheet — save to Files or send onward. Death certificates can be printed to PDF from a finalized case.',
                    ),
                    style: const TextStyle(
                      fontSize: 11,
                      color: DdsColors.mutedForeground,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            SectionCard(
              title: tr('Scheduled reports'),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _name,
                    decoration: InputDecoration(labelText: tr('Report name')),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _schedDays,
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(
                      labelText: tr('Reporting window (days)'),
                    ),
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    initialValue: _interval,
                    decoration: InputDecoration(labelText: tr('Frequency')),
                    items: [
                      DropdownMenuItem(value: '24', child: Text(tr('Daily'))),
                      DropdownMenuItem(value: '168', child: Text(tr('Weekly'))),
                    ],
                    onChanged: (v) => setState(() => _interval = v ?? '24'),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      tr(
                        'Email me when a report is ready (requires configured SMTP)',
                      ),
                      style: const TextStyle(fontSize: 13),
                    ),
                    value: _email,
                    onChanged: (v) => setState(() => _email = v),
                  ),
                  FilledButton(
                    onPressed: () => _run(context, () async {
                      throwIfFailed(
                        await context.read<MutationService>().http(
                          'POST',
                          '/reports/schedule',
                          body: {
                            'name': _name.text.trim(),
                            'days': int.tryParse(_schedDays.text) ?? 30,
                            'intervalHours': int.tryParse(_interval) ?? 24,
                            'emailNotification': _email,
                          },
                        ),
                      );
                      await _load();
                    }, 'Schedule created'),
                    child: Text(tr('Create schedule')),
                  ),
                  const SizedBox(height: 8),
                  for (final s in _schedules.cast<Map<String, dynamic>>())
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        '${s['report_name']}',
                        style: const TextStyle(fontSize: 13),
                      ),
                      subtitle: Text(
                        (s['is_active'] == true || s['is_active'] == 1)
                            ? tr('Active')
                            : tr('Paused'),
                        style: const TextStyle(fontSize: 11),
                      ),
                      trailing: TextButton(
                        onPressed: () => _run(context, () async {
                          throwIfFailed(
                            await context.read<MutationService>().http(
                              'PATCH',
                              '/reports/scheduled/${s['report_id']}',
                              body: {
                                'active':
                                    !(s['is_active'] == true ||
                                        s['is_active'] == 1),
                              },
                              entityType: 'report_schedule',
                              entityId: '${s['report_id']}',
                            ),
                          );
                          await _load();
                        }, 'Schedule updated'),
                        child: Text(
                          (s['is_active'] == true || s['is_active'] == 1)
                              ? tr('Pause')
                              : tr('Resume'),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            SectionCard(
              title: tr('Generated reports'),
              child: _runs.isEmpty
                  ? EmptyState(tr('No generated reports yet.'))
                  : Column(
                      children: [
                        for (final r in _runs.cast<Map<String, dynamic>>())
                          ListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text(
                              fmtDateTime('${r['created_at']}'),
                              style: const TextStyle(fontSize: 13),
                            ),
                            trailing: TextButton(
                              onPressed: () async {
                                try {
                                  final result = await context
                                      .read<ApiClient>()
                                      .get(
                                        '/reports/runs/${r['run_id']}',
                                        useCache: false,
                                      );
                                  final dir = await getTemporaryDirectory();
                                  final file = File(
                                    '${dir.path}/dds-report-${r['run_id']}.json',
                                  );
                                  await file.writeAsString(
                                    const JsonEncoder.withIndent('  ')
                                        .convert(result),
                                  );
                                  await SharePlus.instance.share(
                                    ShareParams(files: [XFile(file.path)]),
                                  );
                                } catch (e) {
                                  if (context.mounted) {
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(content: Text('$e')),
                                    );
                                  }
                                }
                              },
                              child: Text(tr('Download')),
                            ),
                          ),
                      ],
                    ),
            ),
            if (_error != null) loadingOr(_error, onRetry: _load),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }
}

/// Security dashboard — lockouts, sessions, audit-chain integrity.
/// Port of SecurityPage in operations.tsx.
class SecurityScreen extends StatefulWidget {
  const SecurityScreen({super.key});

  @override
  State<SecurityScreen> createState() => _SecurityScreenState();
}

class _SecurityScreenState extends State<SecurityScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  Object? _error;

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
      final res = await context.read<ApiClient>().get(
        '/security/overview',
        useCache: false,
      );
      if (mounted) {
        setState(() {
          _data = res as Map<String, dynamic>;
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

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final integrity = d?['integrity'] as Map<String, dynamic>?;
    final valid = integrity?['valid'] == true;
    return AppScaffold(
      title: tr('Security Dashboard'),
      actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              tr(
                'Account lockouts, live sessions and recent authentication events.',
              ),
              style: const TextStyle(
                fontSize: 12,
                color: DdsColors.mutedForeground,
              ),
            ),
            const SizedBox(height: 12),
            if (_loading)
              loadingOr(null)
            else if (_error != null)
              loadingOr(_error, onRetry: _load)
            else if (d != null) ...[
              SectionCard(
                title: tr('Audit integrity'),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      valid
                          ? tr('Verified {n} records', {
                              'n': '${integrity?['checked'] ?? 0}',
                            })
                          : tr('Chain verification failed after {n} records', {
                              'n': '${integrity?['checked'] ?? 0}',
                            }),
                      style: TextStyle(
                        fontSize: 13,
                        color: valid
                            ? DdsColors.primary
                            : DdsColors.destructive,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    TextButton(
                      onPressed: () => context.go('/audit'),
                      child: Text(tr('Inspect audit trail')),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              SectionCard(
                title: tr('Locked accounts'),
                child: ((d['locked'] as List?) ?? []).isEmpty
                    ? Text(
                        tr('No locked accounts.'),
                        style: const TextStyle(
                          fontSize: 13,
                          color: DdsColors.mutedForeground,
                        ),
                      )
                    : Column(
                        children: [
                          for (final u
                              in (d['locked'] as List)
                                  .cast<Map<String, dynamic>>())
                            ListTile(
                              contentPadding: EdgeInsets.zero,
                              title: Text(
                                '${u['full_name']} · ${u['email']}',
                                style: const TextStyle(fontSize: 13),
                              ),
                              trailing: TextButton(
                                onPressed: () => _run(context, () async {
                                  throwIfFailed(
                                    await context
                                        .read<MutationService>()
                                        .http(
                                          'POST',
                                          '/security/unlock/${u['user_id']}',
                                          entityType: 'user',
                                          entityId: '${u['user_id']}',
                                        ),
                                  );
                                  await _load();
                                }, 'Account unlocked'),
                                child: Text(tr('Unlock')),
                              ),
                            ),
                        ],
                      ),
              ),
              const SizedBox(height: 16),
              SectionCard(
                title: tr('Active sessions'),
                child: ((d['sessions'] as List?) ?? []).isEmpty
                    ? EmptyState(tr('No active sessions.'))
                    : Column(
                        children: [
                          for (final s
                              in (d['sessions'] as List)
                                  .cast<Map<String, dynamic>>()) ...[
                            InfoRow(tr('User'), '${s['full_name'] ?? '—'}'),
                            InfoRow(
                              tr('IP address'),
                              '${s['ip_address'] ?? '—'}',
                            ),
                            InfoRow(
                              tr('Signed in'),
                              fmtDateTime('${s['created_at']}'),
                            ),
                            InfoRow(
                              tr('Expires'),
                              fmtDateTime('${s['expires_at']}'),
                            ),
                            const Divider(),
                          ],
                        ],
                      ),
              ),
              const SizedBox(height: 16),
              SectionCard(
                title: tr('Security events'),
                child: ((d['events'] as List?) ?? []).isEmpty
                    ? EmptyState(tr('No recent events.'))
                    : Column(
                        children: [
                          for (final e
                              in (d['events'] as List)
                                  .cast<Map<String, dynamic>>()) ...[
                            InfoRow(tr('Event'), '${e['action'] ?? '—'}'),
                            InfoRow(
                              tr('IP address'),
                              '${e['ip_address'] ?? '—'}',
                            ),
                            InfoRow(
                              tr('Time'),
                              fmtDateTime('${e['created_at']}'),
                            ),
                            const Divider(),
                          ],
                        ],
                      ),
              ),
            ],
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }
}

/// Global case search — port of SearchPage in operations.tsx.
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _q = TextEditingController();
  List<dynamic> _items = [];
  bool _loading = false;
  bool _searched = false;
  Object? _error;

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    final q = _q.text.trim();
    if (q.length < 2) return;
    setState(() {
      _loading = true;
      _error = null;
      _searched = true;
    });
    try {
      final res = await context.read<ApiClient>().get(
        '/search/global',
        query: {'q': q},
        useCache: false,
      );
      if (mounted) {
        setState(() {
          _items = (res['items'] as List?) ?? [];
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

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: tr('Search'),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            tr(
              'Search cases by name, national ID or notification ID within your permitted scope.',
            ),
            style: const TextStyle(
              fontSize: 12,
              color: DdsColors.mutedForeground,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _q,
                  decoration: InputDecoration(
                    labelText: tr('Search cases'),
                    border: const OutlineInputBorder(),
                  ),
                  onSubmitted: (_) => _search(),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(onPressed: _search, child: Text(tr('Search'))),
            ],
          ),
          const SizedBox(height: 16),
          if (_loading)
            loadingOr(null)
          else if (_error != null)
            loadingOr(_error, onRetry: _search)
          else if (_searched && _items.isEmpty)
            Card(child: EmptyState(tr('No matching cases.')))
          else
            for (final r in _items.cast<Map<String, dynamic>>())
              Card(
                margin: const EdgeInsets.only(bottom: 8),
                child: ListTile(
                  title: Text(
                    '${r['full_name']}',
                    style: const TextStyle(fontSize: 14),
                  ),
                  subtitle: Text(
                    '${r['facility_name'] ?? ''} · ${r['status'] ?? ''}',
                    style: const TextStyle(fontSize: 12),
                  ),
                  trailing: const Icon(Icons.chevron_right, size: 18),
                  onTap: () =>
                      context.push('/notifications/${r['notification_id']}'),
                ),
              ),
          const SizedBox(height: 40),
        ],
      ),
    );
  }
}

/// Executive overview — aggregate stats only (no patient records).
/// Port of ExecutivePage in operations.tsx; also used as the executive
/// role's dashboard (mirrors App.tsx's /dashboard role split).
class ExecutiveScreen extends StatefulWidget {
  const ExecutiveScreen({super.key});

  @override
  State<ExecutiveScreen> createState() => _ExecutiveScreenState();
}

class _ExecutiveScreenState extends State<ExecutiveScreen> {
  Map<String, dynamic>? _summary;
  List<dynamic> _districts = [];
  bool _loading = true;
  Object? _error;

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
      final api = context.read<ApiClient>();
      final results = await Future.wait([
        api.get('/analytics/summary'),
        api.get('/analytics/districts'),
      ]);
      if (mounted) {
        setState(() {
          _summary = results[0] as Map<String, dynamic>?;
          _districts = (results[1]['items'] as List?) ?? [];
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

  int _v(String k) => int.tryParse('${_summary?[k] ?? 0}') ?? 0;

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: tr('Executive Overview'),
      actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              tr(
                'Aggregate mortality surveillance. Individual patient records are excluded.',
              ),
              style: const TextStyle(
                fontSize: 12,
                color: DdsColors.mutedForeground,
              ),
            ),
            const SizedBox(height: 12),
            if (_loading)
              loadingOr(null)
            else if (_error != null)
              loadingOr(_error, onRetry: _load)
            else ...[
              GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 10,
                crossAxisSpacing: 10,
                childAspectRatio: 1.7,
                children: [
                  StatCard(
                    label: tr('Deaths in 7 days'),
                    value: _v('deathsLast7Days'),
                    icon: Icons.trending_up,
                    color: DdsColors.severityCritical,
                    compact: true,
                  ),
                  StatCard(
                    label: tr('Pending reviews'),
                    value: _v('pendingReviews'),
                    icon: Icons.hourglass_empty,
                    color: DdsColors.severityHigh,
                    compact: true,
                  ),
                  StatCard(
                    label: tr('Active alerts'),
                    value: _v('activeAlerts'),
                    icon: Icons.warning_amber,
                    color: DdsColors.destructive,
                    compact: true,
                    pulse: _v('activeAlerts') > 0,
                  ),
                  StatCard(
                    label: tr('Finalized autopsies'),
                    value: _v('finalizedAutopsies'),
                    icon: Icons.fact_check_outlined,
                    color: DdsColors.primary,
                    compact: true,
                  ),
                  StatCard(
                    label: tr('Maternal / perinatal, 30 days'),
                    value: _v('mpdsrLast30Days'),
                    icon: Icons.child_care_outlined,
                    color: DdsColors.accentPurple,
                    compact: true,
                  ),
                  StatCard(
                    label: tr('Total notifications'),
                    value: _v('totalNotifications'),
                    icon: Icons.assignment_outlined,
                    color: DdsColors.linkBlue,
                    compact: true,
                  ),
                ],
              ),
              const SizedBox(height: 16),
              SectionCard(
                title: tr('District surveillance · last 30 days'),
                child: _districts.isEmpty
                    ? EmptyState(tr('No district data.'))
                    : Column(
                        children: [
                          for (final r
                              in _districts.cast<Map<String, dynamic>>()) ...[
                            InfoRow(tr('District'), '${r['district'] ?? '—'}'),
                            InfoRow(
                              tr('Category'),
                              tr('${r['disease_category'] ?? '—'}'),
                            ),
                            InfoRow(tr('Deaths'), '${r['deaths'] ?? 0}'),
                            InfoRow(tr('Pending'), '${r['pending'] ?? 0}'),
                            InfoRow(
                              tr('Maternal / perinatal'),
                              '${r['maternal_perinatal'] ?? 0}',
                            ),
                            const Divider(),
                          ],
                        ],
                      ),
              ),
            ],
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }
}

/// Notification inbox — port of client/src/pages/notifications-center.tsx.
class NotificationsCenterScreen extends StatefulWidget {
  const NotificationsCenterScreen({super.key});

  @override
  State<NotificationsCenterScreen> createState() =>
      _NotificationsCenterScreenState();
}

class _NotificationsCenterScreenState extends State<NotificationsCenterScreen> {
  List<dynamic> _items = [];
  int _unread = 0;
  String _tab = 'all';
  bool _loading = true;
  Object? _error;
  Timer? _poller;

  static const _meta = <String, (IconData, Color)>{
    'alert': (Icons.warning_amber, DdsColors.severityCritical),
    'warning': (Icons.error_outline, DdsColors.severityHigh),
    'autopsy': (Icons.medical_services_outlined, Color(0xFF6366F1)),
    'report': (Icons.description_outlined, DdsColors.linkBlue),
    'signal': (Icons.sensors_outlined, DdsColors.accentPurple),
    'reminder': (Icons.schedule_outlined, Color(0xFF0D9488)),
    'info': (Icons.info_outline, DdsColors.mutedForeground),
  };

  @override
  void initState() {
    super.initState();
    _load();
    _poller = Timer.periodic(const Duration(seconds: 15), (_) => _load());
  }

  @override
  void dispose() {
    _poller?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final res = await context.read<ApiClient>().get('/inbox');
      if (mounted) {
        setState(() {
          _items = (res['items'] as List?) ?? [];
          _unread = int.tryParse('${res['unread'] ?? 0}') ?? 0;
          _loading = false;
          _error = null;
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

  Iterable<Map<String, dynamic>> get _visible {
    final list = _items.cast<Map<String, dynamic>>();
    if (_tab == 'unread') {
      return list.where((n) => n['is_read'] != true && n['is_read'] != 1);
    }
    if (_tab == 'read') {
      return list.where((n) => n['is_read'] == true || n['is_read'] == 1);
    }
    return list;
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: tr('Notifications'),
      actions: [
        if (_unread > 0)
          TextButton.icon(
            onPressed: () => _run(context, () async {
              throwIfFailed(
                await context.read<MutationService>().http(
                  'PATCH',
                  '/inbox/read-all',
                ),
              );
              await _load();
            }, 'All marked read'),
            icon: const Icon(Icons.done_all, size: 16, color: Colors.white),
            label: Text(
              tr('Mark all read'),
              style: const TextStyle(color: Colors.white, fontSize: 12),
            ),
          ),
      ],
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: DdsColors.primary.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.notifications_active_outlined,
                    color: DdsColors.primary,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        tr('Inbox'),
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                        ),
                      ),
                      Text(
                        _unread > 0
                            ? tr('{n} unread', {'n': _unread})
                            : tr("You're all caught up"),
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
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              children: [
                for (final tb in ['all', 'unread', 'read'])
                  ChoiceChip(
                    label: Text(tr(tb[0].toUpperCase() + tb.substring(1))),
                    selected: _tab == tb,
                    onSelected: (_) => setState(() => _tab = tb),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            if (_loading)
              loadingOr(null)
            else if (_error != null)
              loadingOr(_error, onRetry: _load)
            else if (_visible.isEmpty)
              Card(child: EmptyState(tr('No notifications yet.')))
            else
              for (final n in _visible) _inboxTile(n),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }

  Widget _inboxTile(Map<String, dynamic> n) {
    final meta = _meta['${n['notification_type']}'] ?? _meta['info']!;
    final unread = n['is_read'] != true && n['is_read'] != 1;
    final action = '${n['action_url'] ?? ''}';
    final canOpen =
        action.startsWith('/') &&
        !action.startsWith('//') &&
        !action.contains('/inbox');
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: unread ? DdsColors.primary.withValues(alpha: 0.04) : null,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: meta.$2.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Icon(meta.$1, size: 17, color: meta.$2),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${n['title']}',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: unread
                                ? FontWeight.w700
                                : FontWeight.w500,
                          ),
                        ),
                      ),
                      if (unread)
                        Container(
                          width: 8,
                          height: 8,
                          decoration: const BoxDecoration(
                            color: DdsColors.linkBlue,
                            shape: BoxShape.circle,
                          ),
                        ),
                    ],
                  ),
                  if (n['message'] != null && '${n['message']}'.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        '${n['message']}',
                        style: const TextStyle(
                          fontSize: 12,
                          color: DdsColors.mutedForeground,
                        ),
                      ),
                    ),
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      fmtDateTime('${n['created_at']}'),
                      style: const TextStyle(
                        fontSize: 10,
                        color: DdsColors.mutedForeground,
                      ),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 4,
                    children: [
                      if (canOpen)
                        TextButton(
                          onPressed: () => context.push(action),
                          child: Text(
                            tr('Open'),
                            style: const TextStyle(fontSize: 12),
                          ),
                        ),
                      if (unread)
                        TextButton(
                          onPressed: () => _run(context, () async {
                            throwIfFailed(
                              await context.read<MutationService>().http(
                                'PATCH',
                                '/inbox/${n['notification_id']}/read',
                                entityType: 'inbox',
                                entityId: '${n['notification_id']}',
                              ),
                            );
                            await _load();
                          }, 'Marked read'),
                          child: Text(
                            tr('Mark read'),
                            style: const TextStyle(fontSize: 12),
                          ),
                        ),
                      TextButton(
                        onPressed: () => _run(context, () async {
                          throwIfFailed(
                            await context.read<MutationService>().http(
                              'DELETE',
                              '/inbox/${n['notification_id']}',
                              entityType: 'inbox',
                              entityId: '${n['notification_id']}',
                            ),
                          );
                          await _load();
                        }, 'Dismissed'),
                        child: Text(
                          tr('Dismiss'),
                          style: const TextStyle(
                            fontSize: 12,
                            color: DdsColors.mutedForeground,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Reset-password form — port of the reset half of password-reset.tsx.
/// Reached from the sign-in flow; the emailed link's token is pasted in.
class ResetPasswordScreen extends StatefulWidget {
  const ResetPasswordScreen({super.key});

  @override
  State<ResetPasswordScreen> createState() => _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends State<ResetPasswordScreen> {
  final _token = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  bool _loading = false;
  String? _message;

  @override
  void dispose() {
    _token.dispose();
    _password.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _loading = true;
      _message = null;
    });
    try {
      final res = await context.read<ApiClient>().post(
        '/user/reset-password',
        body: {
          'token': _token.text.trim(),
          'newPassword': _password.text,
          'code': _code.text.trim(),
        },
      );
      setState(
        () => _message =
            res['message']?.toString() ??
            tr('Password updated. Sign in with your new password.'),
      );
    } on ApiException catch (e) {
      setState(() => _message = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(tr('Reset password'))),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      tr('Disease Detection System'),
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: DdsColors.primary,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      tr('Reset password'),
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: _token,
                      decoration: InputDecoration(
                        labelText: tr('Reset token (from the email link)'),
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _password,
                      obscureText: true,
                      decoration: InputDecoration(
                        labelText: tr('New password'),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      tr(
                        'At least 8 characters with uppercase, lowercase and a number.',
                      ),
                      style: const TextStyle(
                        fontSize: 11,
                        color: DdsColors.mutedForeground,
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _code,
                      decoration: InputDecoration(
                        labelText: tr(
                          'Authenticator or recovery code (if enabled)',
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: _loading ? null : _submit,
                      child: _loading
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : Text(tr('Reset password')),
                    ),
                    if (_message != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Text(
                          _message!,
                          style: const TextStyle(fontSize: 13),
                        ),
                      ),
                    TextButton(
                      onPressed: () => context.go('/sign-in'),
                      child: Text(
                        tr('Return to sign in'),
                        style: const TextStyle(
                          decoration: TextDecoration.underline,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
