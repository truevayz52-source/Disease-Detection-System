import 'dart:convert' show jsonDecode;

import 'package:flutter/material.dart' hide InputDecoration, Text, TextSpan;
import 'package:dds_mobile/l10n/localized_widgets.dart';
import 'package:provider/provider.dart';

import '../../data/api_client.dart';
import '../../data/mutation_service.dart';
import '../../l10n/app_localizations.dart';
import '../../ui/app_shell.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// Shared helpers for the small workflow ports in client/src/pages/workflows.tsx.

Widget _field(
  String label,
  TextEditingController c, {
  TextInputType? keyboard,
  int maxLines = 1,
}) => Padding(
  padding: const EdgeInsets.only(bottom: 12),
  child: TextField(
    controller: c,
    keyboardType: keyboard,
    maxLines: maxLines,
    decoration: InputDecoration(labelText: tr(label)),
  ),
);

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

/// Simple list row (mirrors the web Rows table as stacked label/value lines).
class _RowsCard extends StatelessWidget {
  const _RowsCard({required this.columns, required this.items});

  final List<String> columns; // [key, label, key, label, …]
  final List<dynamic> items;

  @override
  Widget build(BuildContext context) => SectionCard(
    title: tr('Records'),
    child: items.isEmpty
        ? EmptyState(tr('Nothing to show.'))
        : Column(
            children: [
              for (final it in items.cast<Map<String, dynamic>>())
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Column(
                    children: [
                      for (var i = 0; i < columns.length; i += 2)
                        InfoRow(tr(columns[i + 1]), '${it[columns[i]] ?? '—'}'),
                    ],
                  ),
                ),
            ],
          ),
  );
}

/// MPDSR review workflows — real closed-loop maternal/perinatal review:
/// notified → in_review → actions_assigned → completed.
class MpdsrScreen extends StatefulWidget {
  const MpdsrScreen({super.key});

  @override
  State<MpdsrScreen> createState() => _MpdsrScreenState();
}

class _MpdsrScreenState extends State<MpdsrScreen> {
  List<dynamic> _items = [];
  List<dynamic> _queue = [];
  bool _loading = true;
  Object? _error;
  String _filter = 'all';

  static const _stages = [
    'notified',
    'in_review',
    'actions_assigned',
    'completed',
  ];

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
    final api = context.read<ApiClient>();
    try {
      final res = await api.get(
        '/mpdsr/workflows',
        query: _filter == 'all' ? {} : {'stage': _filter},
      );
      final q = await api.get('/mpdsr/queue');
      if (mounted) {
        setState(() {
          _items = (res['items'] as List?) ?? [];
          _queue = (q['items'] as List?) ?? [];
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

  int _count(String stage) =>
      _items.where((w) => w['response_status'] == stage).length;
  int get _overdue => _items.where((w) => w['overdue'] == true).length;

  String _label(String s) {
    final m = {
      'notified': tr('Notified'),
      'in_review': tr('In review'),
      'actions_assigned': tr('Actions assigned'),
      'completed': tr('Completed'),
    };
    return m[s] ?? tr(s);
  }

  Widget _mini(String label, int value, Color color) => Container(
    width: 100,
    margin: const EdgeInsets.only(right: 8),
    padding: const EdgeInsets.all(10),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(10),
      border: Border.all(color: color.withValues(alpha: 0.4)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 10,
            color: DdsColors.mutedForeground,
          ),
        ),
        Text(
          '$value',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w700,
            color: color,
          ),
        ),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: tr('MPDSR Workflows'),
      actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              tr(
                'Maternal/perinatal death review pipeline: notified → review → corrective actions → closed-loop completion.',
              ),
              style: const TextStyle(
                fontSize: 12,
                color: DdsColors.mutedForeground,
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 62,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  _mini(tr('Awaiting'), _queue.length, DdsColors.severityHigh),
                  _mini(
                    tr('Notified'),
                    _count('notified'),
                    DdsColors.severityMedium,
                  ),
                  _mini(
                    tr('In review'),
                    _count('in_review'),
                    DdsColors.linkBlue,
                  ),
                  _mini(
                    tr('Actions'),
                    _count('actions_assigned'),
                    DdsColors.accentPurple,
                  ),
                  _mini(
                    tr('Completed'),
                    _count('completed'),
                    DdsColors.success,
                  ),
                  _mini(tr('Overdue'), _overdue, DdsColors.severityCritical),
                ],
              ),
            ),
            const SizedBox(height: 12),
            if (_queue.isNotEmpty)
              SectionCard(
                title: tr('Awaiting review start'),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final n in _queue)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    '${n['patient_name']} · ${n['facility_name']}',
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  Text(
                                    '${n['district']} · ${n['date_of_death']}',
                                    style: const TextStyle(
                                      fontSize: 12,
                                      color: DdsColors.mutedForeground,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            FilledButton(
                              onPressed: () => _run(context, () async {
                                throwIfFailed(
                                  await context.read<MutationService>().http(
                                    'POST',
                                    '/mpdsr/workflows',
                                    body: {
                                      'notificationId': n['notification_id'],
                                    },
                                    entityType: 'mpdsr',
                                    entityId:
                                        '${n['notification_id']}',
                                  ),
                                );
                                await _load();
                              }, 'Review opened'),
                              child: Text(tr('Open review')),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            if (_queue.isNotEmpty) const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              children: [
                for (final s in ['all', ..._stages])
                  ChoiceChip(
                    label: Text(s == 'all' ? tr('All') : _label(s)),
                    selected: _filter == s,
                    onSelected: (_) {
                      setState(() => _filter = s);
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
              Card(child: EmptyState(tr('No reviews found.')))
            else
              for (final w in _items.cast<Map<String, dynamic>>())
                _workflowCard(w),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }

  Widget _workflowCard(Map<String, dynamic> w) =>
      _WorkflowCard(key: ValueKey(w['workflow_id']), item: w, refresh: _load);
}

class _WorkflowCard extends StatefulWidget {
  const _WorkflowCard({super.key, required this.item, required this.refresh});

  final Map<String, dynamic> item;
  final Future<void> Function() refresh;

  @override
  State<_WorkflowCard> createState() => _WorkflowCardState();
}

class _WorkflowCardState extends State<_WorkflowCard> {
  late final TextEditingController _panel = TextEditingController(
    text: '${widget.item['review_panel'] ?? ''}',
  );
  late String _cause = '${widget.item['cause_classification'] ?? ''}';
  late String _preventability = '${widget.item['preventability'] ?? ''}';
  late final TextEditingController _factors = TextEditingController(
    text:
        ((widget.item['contributing_factors'] as String?) != null
                ? (jsonDecode(widget.item['contributing_factors']) as List)
                      .cast<String>()
                : <String>[])
            .join('\n'),
  );
  late final TextEditingController _notes = TextEditingController(
    text: '${widget.item['investigation_notes'] ?? ''}',
  );
  late String _reviewDate = _toDate(widget.item['reviewed_at']);

  final TextEditingController _actionText = TextEditingController();
  final TextEditingController _responsible = TextEditingController();
  String _dueDate = '';
  List<dynamic> _actions = [];
  bool _loadingActions = true;

  @override
  void initState() {
    super.initState();
    _loadActions();
  }

  @override
  void dispose() {
    _panel.dispose();
    _factors.dispose();
    _notes.dispose();
    _actionText.dispose();
    _responsible.dispose();
    super.dispose();
  }

  static String _toDate(dynamic d) {
    if (d == null || '$d'.isEmpty) return '';
    final dt = DateTime.tryParse('$d');
    if (dt == null) return '';
    return '${dt.year.toString().padLeft(4, '0')}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')}';
  }

  Future<void> _loadActions() async {
    final stage = '${widget.item['response_status']}';
    if (stage != 'actions_assigned' && stage != 'completed') {
      setState(() => _loadingActions = false);
      return;
    }
    final api = context.read<ApiClient>();
    try {
      final res = await api.get(
        '/mpdsr/workflows/${widget.item['workflow_id']}',
      );
      if (mounted) {
        setState(() {
          _actions = (res['actions'] as List?) ?? [];
          _loadingActions = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _loadingActions = false);
    }
  }

  Future<void> _patch(Map<String, dynamic> body) => _run(context, () async {
    throwIfFailed(
      await context.read<MutationService>().http(
        'PATCH',
        '/mpdsr/workflows/${widget.item['workflow_id']}',
        body: body,
        entityType: 'mpdsr',
        entityId: '${widget.item['workflow_id']}',
      ),
    );
    await widget.refresh();
  }, 'Review updated');

  Future<void> _addAction() => _run(context, () async {
    throwIfFailed(
      await context.read<MutationService>().http(
        'POST',
        '/mpdsr/workflows/${widget.item['workflow_id']}/actions',
        body: {
          'text': _actionText.text.trim(),
          'responsible': _responsible.text.trim(),
          'dueDate': _dueDate,
        },
        entityType: 'mpdsr',
        entityId: '${widget.item['workflow_id']}',
      ),
    );
    _actionText.clear();
    _responsible.clear();
    setState(() => _dueDate = '');
    await _loadActions();
  }, 'Action added');

  Future<void> _resolveAction(String id, String status) =>
      _run(context, () async {
        throwIfFailed(
          await context.read<MutationService>().http(
            'PATCH',
            '/mpdsr/actions/$id',
            body: {'status': status},
            entityType: 'mpdsr_action',
            entityId: id,
          ),
        );
        await _loadActions();
      }, 'Action updated');

  Future<void> _pickDueDate() async {
    final d = await showDatePicker(
      context: context,
      initialDate: DateTime.now(),
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (d != null && mounted) {
      setState(() => _dueDate = _toDate(d.toIso8601String()));
    }
  }

  @override
  Widget build(BuildContext context) {
    final w = widget.item;
    final stage = '${w['response_status']}';
    final overdue = w['overdue'] == true;

    Widget badge(String text, Color color) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
    );

    final stageColor = switch (stage) {
      'notified' => DdsColors.severityMedium,
      'in_review' => DdsColors.linkBlue,
      'actions_assigned' => DdsColors.accentPurple,
      'completed' => DdsColors.success,
      _ => DdsColors.mutedForeground,
    };

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      color: stageColor.withValues(alpha: 0.05),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: stageColor.withValues(alpha: 0.4), width: 1),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${w['facility_name']}',
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                        ),
                      ),
                      Text(
                        '${w['patient_name']} · ${w['date_of_death']}',
                        style: const TextStyle(
                          fontSize: 12,
                          color: DdsColors.mutedForeground,
                        ),
                      ),
                    ],
                  ),
                ),
                badge(
                  stage == 'actions_assigned'
                      ? tr('Actions assigned')
                      : _stageLabel(stage),
                  stageColor,
                ),
              ],
            ),
            if (overdue)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  tr('Review overdue'),
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: DdsColors.severityCritical,
                  ),
                ),
              ),
            if (w['review_due_at'] != null)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                  '${tr('Review due')}: ${w['review_due_at']}',
                  style: const TextStyle(
                    fontSize: 11,
                    color: DdsColors.mutedForeground,
                  ),
                ),
              ),
            const SizedBox(height: 12),
            if (stage == 'notified') ...[
              Text(
                tr(
                  'Start the committee review by recording the panel and review date.',
                ),
                style: const TextStyle(
                  fontSize: 12,
                  color: DdsColors.mutedForeground,
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _panel,
                decoration: InputDecoration(labelText: tr('Review panel')),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: TextEditingController(text: _reviewDate),
                decoration: InputDecoration(
                  labelText: tr('Review date'),
                  hintText: 'YYYY-MM-DD',
                ),
                onChanged: (v) => _reviewDate = v,
              ),
              const SizedBox(height: 10),
              FilledButton(
                onPressed: () => _patch({
                  'stage': 'in_review',
                  'reviewPanel': _panel.text,
                  'reviewDate': _reviewDate,
                }),
                child: Text(tr('Start review')),
              ),
            ],
            if (stage == 'in_review') ...[
              DropdownButtonFormField<String>(
                initialValue: _cause.isEmpty ? null : _cause,
                decoration: InputDecoration(
                  labelText: tr('Cause classification'),
                ),
                items: [
                  for (final v in [
                    'direct_obstetric',
                    'indirect_obstetric',
                    'coincidental',
                    'undetermined',
                  ])
                    DropdownMenuItem(
                      value: v,
                      child: Text(tr(v.replaceAll('_', ' '))),
                    ),
                ],
                onChanged: (v) => setState(() => _cause = v ?? _cause),
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                initialValue: _preventability.isEmpty ? null : _preventability,
                decoration: InputDecoration(labelText: tr('Preventability')),
                items: [
                  for (final v in [
                    'preventable',
                    'potentially_preventable',
                    'not_preventable',
                    'undetermined',
                  ])
                    DropdownMenuItem(
                      value: v,
                      child: Text(tr(v.replaceAll('_', ' '))),
                    ),
                ],
                onChanged: (v) =>
                    setState(() => _preventability = v ?? _preventability),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _factors,
                maxLines: 3,
                decoration: InputDecoration(
                  labelText: tr('Contributing factors'),
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _notes,
                maxLines: 3,
                decoration: InputDecoration(
                  labelText: tr('Investigation notes'),
                ),
              ),
              const SizedBox(height: 10),
              FilledButton(
                onPressed: () => _patch({
                  'stage': 'actions_assigned',
                  'causeClassification': _cause,
                  'preventability': _preventability,
                  'contributingFactors': _factors.text
                      .split('\n')
                      .map((s) => s.trim())
                      .where((s) => s.isNotEmpty)
                      .toList(),
                  'notes': _notes.text,
                }),
                child: Text(tr('Record findings → actions')),
              ),
            ],
            if (stage == 'actions_assigned' || stage == 'completed') ...[
              Text(
                '${tr('Cause')}: ${w['cause_classification'] != null ? tr('${w['cause_classification']}'.replaceAll('_', ' ')) : '-'}',
                style: const TextStyle(fontSize: 13),
              ),
              Text(
                '${tr('Preventability')}: ${w['preventability'] != null ? tr('${w['preventability']}'.replaceAll('_', ' ')) : '-'}',
                style: const TextStyle(fontSize: 13),
              ),
              const SizedBox(height: 6),
              Text(
                '${tr('Contributing factors')}:',
                style: const TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 12,
                ),
              ),
              ..._factorList(
                w,
              ).map((f) => Text('• $f', style: const TextStyle(fontSize: 12))),
              if (stage == 'actions_assigned') ...[
                const SizedBox(height: 12),
                TextField(
                  controller: _actionText,
                  decoration: InputDecoration(labelText: tr('Action')),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _responsible,
                  decoration: InputDecoration(labelText: tr('Responsible')),
                ),
                const SizedBox(height: 8),
                InkWell(
                  onTap: _pickDueDate,
                  child: InputDecorator(
                    decoration: InputDecoration(labelText: tr('Due date')),
                    child: Text(
                      _dueDate.isEmpty ? tr('Select date') : _dueDate,
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                FilledButton(
                  onPressed: _addAction,
                  child: Text(tr('Add action')),
                ),
                const SizedBox(height: 10),
                FilledButton(
                  onPressed: () => _patch({'stage': 'completed'}),
                  child: Text(tr('Close review')),
                ),
              ],
              if (_loadingActions)
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (_actions.isNotEmpty) ...[
                const SizedBox(height: 12),
                Text(
                  tr('Corrective actions'),
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    fontSize: 12,
                  ),
                ),
                for (final a in _actions)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                a['action_text'],
                                style: a['status'] != 'open'
                                    ? const TextStyle(
                                        decoration: TextDecoration.lineThrough,
                                        color: DdsColors.mutedForeground,
                                      )
                                    : null,
                              ),
                              Text(
                                '${a['responsible_party']} · ${tr('due')} ${a['due_date'] ?? '-'}',
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: DdsColors.mutedForeground,
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (a['status'] == 'open' &&
                            stage == 'actions_assigned')
                          Row(
                            children: [
                              TextButton(
                                onPressed: () =>
                                    _resolveAction(a['action_id'], 'done'),
                                child: const Icon(Icons.check, size: 18),
                              ),
                              TextButton(
                                onPressed: () =>
                                    _resolveAction(a['action_id'], 'cancelled'),
                                child: const Icon(Icons.close, size: 18),
                              ),
                            ],
                          )
                        else
                          Text(
                            a['status'],
                            style: const TextStyle(fontSize: 11),
                          ),
                      ],
                    ),
                  ),
              ],
            ],
          ],
        ),
      ),
    );
  }

  String _stageLabel(String s) {
    final m = {
      'notified': 'Notified',
      'in_review': 'In review',
      'actions_assigned': 'Actions assigned',
      'completed': 'Completed',
    };
    return tr(m[s] ?? s);
  }

  List<String> _factorList(Map<String, dynamic> w) {
    final raw = w['contributing_factors'];
    if (raw == null) return [];
    try {
      return (jsonDecode(raw) as List).cast<String>();
    } catch (_) {
      return ['$raw'];
    }
  }
}

/// Alert thresholds — create / activate / delete detection rules.
class ThresholdsScreen extends StatefulWidget {
  const ThresholdsScreen({super.key});

  @override
  State<ThresholdsScreen> createState() => _ThresholdsScreenState();
}

class _ThresholdsScreenState extends State<ThresholdsScreen> {
  final _district = TextEditingController();
  final _category = TextEditingController();
  final _count = TextEditingController(text: '8');
  final _hours = TextEditingController(text: '48');
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
    _district.dispose();
    _category.dispose();
    _count.dispose();
    _hours.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await context.read<ApiClient>().get('/alerts/thresholds');
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
      title: tr('Alert Thresholds'),
      actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              tr(
                'Configure district and disease reporting thresholds. Leave a filter blank to match all values.',
              ),
              style: const TextStyle(
                fontSize: 12,
                color: DdsColors.mutedForeground,
              ),
            ),
            const SizedBox(height: 12),
            SectionCard(
              title: tr('New detection rule'),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _field('District (optional)', _district),
                  _field('Disease category (optional)', _category),
                  _field(
                    'Minimum reported deaths',
                    _count,
                    keyboard: TextInputType.number,
                  ),
                  _field(
                    'Time window (hours)',
                    _hours,
                    keyboard: TextInputType.number,
                  ),
                  Text(
                    tr(
                      'Trigger at {count} reported deaths within {hours} hours.',
                      {'count': _count.text, 'hours': _hours.text},
                    ),
                    style: const TextStyle(
                      fontSize: 12,
                      color: DdsColors.mutedForeground,
                    ),
                  ),
                  const SizedBox(height: 8),
                  FilledButton(
                    onPressed: () => _run(context, () async {
                      throwIfFailed(
                        await context.read<MutationService>().http(
                          'POST',
                          '/alerts/thresholds',
                          entityType: 'alert_threshold',
                          body: {
                            'district': _district.text.trim().isEmpty
                                ? null
                                : _district.text.trim(),
                            'diseaseCategory': _category.text.trim().isEmpty
                                ? null
                                : _category.text.trim(),
                            'caseThreshold': int.tryParse(_count.text) ?? 8,
                            'timeWindowHours':
                                int.tryParse(_hours.text) ?? 48,
                          },
                        ),
                      );
                      await _load();
                    }, 'Threshold saved'),
                    child: Text(tr('Save rule')),
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
              Card(child: EmptyState(tr('No rules configured.')))
            else
              for (final r in _items.cast<Map<String, dynamic>>()) _ruleCard(r),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }

  Widget _ruleCard(Map<String, dynamic> r) {
    final active = r['is_active'] == true || r['is_active'] == 1;
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${r['district'] ?? tr('All districts')} · ${r['disease_category'] ?? tr('All categories')}',
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
            ),
            const SizedBox(height: 4),
            Text(
              '${tr('{n} deaths / {h} hours', {'n': '${r['case_threshold']}', 'h': '${r['time_window_hours']}'})} · ${active ? tr('Active') : tr('Inactive')}',
              style: const TextStyle(
                fontSize: 12,
                color: DdsColors.mutedForeground,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                OutlinedButton(
                  onPressed: () => _run(context, () async {
                    throwIfFailed(
                      await context.read<MutationService>().http(
                        'PATCH',
                        '/alerts/thresholds/${r['threshold_id']}',
                        body: {
                          'district': r['district'],
                          'diseaseCategory': r['disease_category'],
                          'caseThreshold': r['case_threshold'],
                          'timeWindowHours': r['time_window_hours'],
                          'priority': r['alert_priority'],
                          'active': !active,
                        },
                        entityType: 'alert_threshold',
                        entityId: '${r['threshold_id']}',
                      ),
                    );
                    await _load();
                  }, active ? 'Rule deactivated' : 'Rule activated'),
                  child: Text(active ? tr('Deactivate') : tr('Activate')),
                ),
                OutlinedButton(
                  onPressed: () => _run(context, () async {
                    throwIfFailed(
                      await context.read<MutationService>().http(
                        'DELETE',
                        '/alerts/thresholds/${r['threshold_id']}',
                        entityType: 'alert_threshold',
                        entityId: '${r['threshold_id']}',
                      ),
                    );
                    await _load();
                  }, 'Rule deleted'),
                  child: Text(tr('Delete rule')),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Cross-border case tracking — record travel history for a notification.
class CrossBorderScreen extends StatefulWidget {
  const CrossBorderScreen({super.key});

  @override
  State<CrossBorderScreen> createState() => _CrossBorderScreenState();
}

class _CrossBorderScreenState extends State<CrossBorderScreen> {
  final _id = TextEditingController();
  final _country = TextEditingController();
  final _crossing = TextEditingController();
  final _history = TextEditingController();
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
    _id.dispose();
    _country.dispose();
    _crossing.dispose();
    _history.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await context.read<ApiClient>().get('/cross-border/cases');
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
      title: tr('Cross-border Tracking'),
      actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              tr('Record reported travel history for surveillance review.'),
              style: const TextStyle(
                fontSize: 12,
                color: DdsColors.mutedForeground,
              ),
            ),
            const SizedBox(height: 12),
            SectionCard(
              title: tr('Mark a case'),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _field('Notification ID', _id),
                  _field('Source country', _country),
                  _field('Border crossing', _crossing),
                  _field('Travel history', _history, maxLines: 3),
                  FilledButton(
                    onPressed: () => _run(context, () async {
                      throwIfFailed(
                        await context.read<MutationService>().http(
                          'POST',
                          '/cross-border/mark',
                          body: {
                            'notificationId': _id.text.trim(),
                            'sourceCountry': _country.text.trim(),
                            'borderCrossingPoint': _crossing.text.trim(),
                            'travelHistory': _history.text.trim(),
                          },
                          entityType: 'death_notification',
                          entityId: _id.text.trim(),
                        ),
                      );
                      await _load();
                    }, 'Travel history recorded'),
                    child: Text(tr('Save case')),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            if (_loading)
              loadingOr(null)
            else if (_error != null)
              loadingOr(_error, onRetry: _load)
            else
              _RowsCard(
                columns: [
                  'source_country',
                  tr('Source country'),
                  'border_crossing_point',
                  tr('Crossing'),
                  'district',
                  tr('District'),
                  'travel_history',
                  tr('Travel history'),
                ],
                items: _items,
              ),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }
}
