import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart' hide InputDecoration, Text, TextSpan;
import 'package:dds_mobile/l10n/localized_widgets.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../data/api_client.dart';
import '../../data/auth_repository.dart';
import '../../data/draft_store.dart';
import '../../data/mutation_service.dart';
import '../../l10n/app_localizations.dart';
import '../../ui/app_shell.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// Port of client/src/pages/signals.tsx — mortality-signal registry with
/// status filters, risk/severity badges, triage workflow transitions,
/// playbook attach and evidence upload.

// Signal types that represent a death — these can be converted straight
// into a death notification once verified.
const kDeathSignalTypes = {
  'unreported_death',
  'suspicious_death',
  'maternal_perinatal',
  'death_cluster',
};

const kSignalTypeLabels = {
  'unreported_death': 'Unreported death',
  'suspicious_death': 'Suspicious death',
  'maternal_perinatal': 'Maternal / perinatal death',
  'death_cluster': 'Death cluster',
  'community_alert': 'Community alert',
};

class SignalsScreen extends StatefulWidget {
  const SignalsScreen({super.key});

  @override
  State<SignalsScreen> createState() => _SignalsScreenState();
}

class _SignalsScreenState extends State<SignalsScreen> {
  static const _statuses = [
    'new',
    'triaged',
    'investigating',
    'resolved',
    'dismissed',
  ];

  String _status = 'new';
  List<dynamic> _items = [];
  List<dynamic> _playbooks = [];
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
        api.get('/signals', query: {'status': _status}),
        api.get('/playbooks'),
      ]);
      if (!mounted) return;
      setState(() {
        _items = (results[0]['items'] as List?) ?? [];
        _playbooks = (results[1]['items'] as List?) ?? [];
        _loading = false;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e;
          _loading = false;
        });
      }
    }
  }

  Future<void> _act(Future<dynamic> Function() fn, String ok) async {
    try {
      await fn();
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(tr(ok))));
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  Future<void> _transition(
    Map<String, dynamic> s,
    String stage, [
    String? next,
  ]) => _act(() async {
    throwIfFailed(
      await context.read<MutationService>().http(
        'PATCH',
        '/signals/${s['signal_id']}/workflow',
        body: {'stage': stage, 'status': ?next},
        entityType: 'signal',
        entityId: '${s['signal_id']}',
      ),
    );
  }, 'Signal updated.');

  Future<void> _attachEvidence(Map<String, dynamic> s) async {
    final file = await FilePicker.pickFile();
    final path = file?.path;
    if (path == null || !mounted) return;
    await _act(() async {
      throwIfFailed(
        await context.read<MutationService>().upload(
          '/evidence',
          path,
          fields: {'entityType': 'signal', 'entityId': '${s['signal_id']}'},
          entityType: 'signal',
          entityId: '${s['signal_id']}',
        ),
      );
    }, 'Evidence uploaded.');
  }

  Future<void> _newSignal() async {
    final saved = await showDialog<bool>(
      context: context,
      builder: (_) => const _SignalDialog(),
    );
    if (saved == true) _load();
  }

  // Attach an active outbreak alert to a death-cluster signal.
  Future<void> _linkAlert(Map<String, dynamic> s) async {
    try {
      final res = await context.read<ApiClient>().get(
        '/alerts',
        query: {'status': 'active'},
      );
      final items = (res['items'] as List?) ?? [];
      if (!mounted) return;
      if (items.isEmpty) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(tr('No active alerts.'))));
        return;
      }
      final picked = await showDialog<String>(
        context: context,
        builder: (ctx) => SimpleDialog(
          title: Text(tr('Link outbreak alert')),
          children: [
            for (final a in items)
              SimpleDialogOption(
                onPressed: () => Navigator.pop(ctx, '${a['alert_id']}'),
                child: Text(
                  '${a['disease_category']} — ${a['district']}',
                  style: const TextStyle(fontSize: 13),
                ),
              ),
          ],
        ),
      );
      if (picked == null || !mounted) return;
      await _act(() async {
        throwIfFailed(
          await context.read<MutationService>().http(
            'PATCH',
            '/signals/${s['signal_id']}/workflow',
            body: {'linkedAlertId': picked},
            entityType: 'signal',
            entityId: '${s['signal_id']}',
          ),
        );
      }, 'Alert linked.');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  // Convert a death signal into a prefilled death-notification draft; the
  // signal id rides along so submitting the notification links back to it.
  Future<void> _createFromSignal(Map<String, dynamic> s) async {
    await DraftStore().saveDraft({
      'facilityId': s['facility_id'] ?? '',
      'residentialAddress': [
        if (s['district'] != null && '${s['district']}'.isNotEmpty)
          '${s['district']}',
        if (s['province'] != null && '${s['province']}'.isNotEmpty)
          '${s['province']}',
      ].join(', '),
      'clinicalSummary': s['description'] ?? '',
      'isMaternalPerinatal': s['signal_type'] == 'maternal_perinatal',
      'linkedSignalId': s['signal_id'],
    });
    if (mounted) context.push('/notifications/new');
  }

  @override
  Widget build(BuildContext context) {
    final role = context.watch<AuthRepository>().user?.role;
    final canTriage = const ['public_health_analyst'].contains(role);
    final canCreate =
        const ['medical_officer', 'mortuary_clerk'].contains(role);
    final canCapture = const [
      'medical_officer',
      'mortuary_clerk',
      'public_health_analyst',
    ].contains(role);

    return AppScaffold(
      title: tr('Mortality Signals'),
      actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      floatingActionButton: !canCapture
          ? null
          : FloatingActionButton.extended(
        onPressed: _newSignal,
        icon: const Icon(Icons.add),
        label: Text(tr('New signal')),
      ),
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
                    '${_status[0].toUpperCase()}${_status.substring(1)} ${tr('signals')}',
                    _items.length,
                    Icons.sensors,
                    DdsColors.linkBlue,
                  ),
                  _mini(
                    tr('High risk (≥60)'),
                    _items
                        .where(
                          (s) =>
                              (num.tryParse('${s['risk_score']}') ?? 0) >= 60,
                        )
                        .length,
                    Icons.emergency_outlined,
                    DdsColors.severityCritical,
                  ),
                  _mini(
                    tr('Overdue SLA'),
                    _items.where((s) => s['overdue'] == true).length,
                    Icons.timer_outlined,
                    DdsColors.severityHigh,
                  ),
                  _mini(
                    tr('Critical severity'),
                    _items.where((s) => s['severity'] == 'critical').length,
                    Icons.warning_amber,
                    DdsColors.accentPurple,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              children: [
                for (final s in _statuses)
                  ChoiceChip(
                    label: Text(tr(s[0].toUpperCase() + s.substring(1))),
                    selected: _status == s,
                    onSelected: (_) {
                      setState(() => _status = s);
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
              Card(
                child: EmptyState(
                  tr('No {status} signals.', {'status': tr(_status)}),
                ),
              )
            else
              for (final s in _items.cast<Map<String, dynamic>>())
                _signalCard(s, canTriage, canCreate),
            const SizedBox(height: 80),
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

  Widget _pill(String text, Color color) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(999),
      border: Border.all(color: color.withValues(alpha: 0.4)),
    ),
    child: Text(
      tr(text),
      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: color),
    ),
  );

  Widget _signalCard(Map<String, dynamic> s, bool canTriage, bool canCreate) {
    final severity = '${s['severity']}';
    final sevColor = switch (severity) {
      'critical' || 'high' => DdsColors.severityCritical,
      'medium' => DdsColors.severityMedium,
      _ => DdsColors.mutedForeground,
    };
    final risk = num.tryParse('${s['risk_score']}');
    final stage = '${s['workflow_stage']}';
    final status = '${s['status']}';
    final meta = [
      tr(
        kSignalTypeLabels['${s['signal_type']}'] ??
            '${s['signal_type']}'.replaceAll('_', ' '),
      ),
      '${s['source_channel']}',
      if (s['district'] != null && '${s['district']}'.isNotEmpty)
        '${s['district']}',
      if (s['province'] != null && '${s['province']}'.isNotEmpty)
        '${s['province']}',
    ].join(' · ');

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${s['title']}',
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 15,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        meta,
                        style: const TextStyle(
                          fontSize: 12,
                          color: DdsColors.mutedForeground,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                if (risk != null)
                  _pill(
                    tr('Risk {n}', {'n': risk.toStringAsFixed(0)}),
                    risk >= 60
                        ? DdsColors.severityCritical
                        : risk >= 40
                        ? DdsColors.severityHigh
                        : DdsColors.mutedForeground,
                  ),
                if (s['overdue'] == true)
                  _pill(tr('Overdue'), DdsColors.severityCritical),
                _pill(severity, sevColor),
                _pill(stage.replaceAll('_', ' '), DdsColors.linkBlue),
              ],
            ),
            if (s['description'] != null && '${s['description']}'.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  '${s['description']}',
                  style: const TextStyle(
                    fontSize: 13,
                    color: DdsColors.mutedForeground,
                  ),
                ),
              ),
            if (s['classified_topics'] != null || s['sentiment'] != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  [
                    if (s['classified_topics'] != null)
                      tr('Topics: {t}', {
                        't': '${s['classified_topics']}'.replaceAll(',', ', '),
                      }),
                    if (s['sentiment'] != null)
                      tr('Sentiment: {s}', {'s': '${s['sentiment']}'}),
                    if (s['sla_due_at'] != null)
                      tr('Response due {ts}', {
                        'ts': fmtDateTime('${s['sla_due_at']}'),
                      }),
                  ].join(' · '),
                  style: const TextStyle(
                    fontSize: 11,
                    color: DdsColors.mutedForeground,
                  ),
                ),
              ),
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                tr('Reported {ts}', {
                      'ts': fmtDateTime('${s['reported_at']}'),
                    }) +
                    [
                      if (s['reporter_name'] != null)
                        'by ${s['reporter_name']}',
                      if (s['facility_name'] != null) '${s['facility_name']}',
                    ].join(' · '),
                style: const TextStyle(
                  fontSize: 11,
                  color: DdsColors.mutedForeground,
                ),
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 4,
              children: [
                if (canTriage && stage == 'captured')
                  OutlinedButton(
                    onPressed: () => _transition(s, 'verified', 'triaged'),
                    child: Text(tr('Verify')),
                  ),
                if (canTriage && stage == 'verified')
                  OutlinedButton(
                    onPressed: () =>
                        _transition(s, 'escalated', 'investigating'),
                    child: Text(tr('Escalate')),
                  ),
                if (canTriage && stage == 'escalated')
                  OutlinedButton(
                    onPressed: () => _transition(s, 'closed', 'resolved'),
                    child: Text(tr('Close as resolved')),
                  ),
                if (canTriage && status != 'dismissed' && status != 'resolved')
                  TextButton(
                    onPressed: () => _transition(s, 'closed', 'dismissed'),
                    child: Text(tr('Dismiss')),
                  ),
                // Conversion is gated on verification — an unverified signal
                // must not become an official death record.
                if (canCreate &&
                    kDeathSignalTypes.contains('${s['signal_type']}') &&
                    (stage == 'verified' || stage == 'escalated'))
                  OutlinedButton.icon(
                    onPressed: () => _createFromSignal(s),
                    icon: const Icon(Icons.post_add, size: 15),
                    label: Text(
                      tr('Create notification'),
                      style: const TextStyle(fontSize: 12),
                    ),
                  ),
                if (canTriage &&
                    s['signal_type'] == 'death_cluster' &&
                    stage != 'closed' &&
                    s['linked_alert_id'] == null)
                  OutlinedButton(
                    onPressed: () => _linkAlert(s),
                    child: Text(tr('Link outbreak alert')),
                  ),
                if (canTriage && _playbooks.isNotEmpty) _playbookPicker(s),
                TextButton.icon(
                  onPressed: () => _attachEvidence(s),
                  icon: const Icon(Icons.attach_file, size: 15),
                  label: Text(
                    tr('Attach evidence'),
                    style: const TextStyle(fontSize: 12),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _playbookPicker(Map<String, dynamic> s) => SizedBox(
    width: 170,
    height: 36,
    child: DropdownButtonFormField<String>(
      decoration: InputDecoration(
        labelText: tr('Attach playbook'),
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        border: const OutlineInputBorder(),
      ),
      initialValue: null,
      items: [
        for (final pb in _playbooks)
          DropdownMenuItem<String>(
            value: '${pb['playbook_id']}',
            child: Text(
              '${pb['name']}',
              style: const TextStyle(fontSize: 12),
              overflow: TextOverflow.ellipsis,
            ),
          ),
      ],
      onChanged: (id) {
        if (id == null) return;
        _act(() async {
          throwIfFailed(
            await context.read<MutationService>().http(
              'POST',
              '/signals/${s['signal_id']}/playbook',
              body: {'playbookId': id},
              entityType: 'signal',
              entityId: '${s['signal_id']}',
              coalesceKey: 'playbook:${s['signal_id']}',
            ),
          );
        }, 'Playbook attached.');
      },
    ),
  );
}

/// New-signal dialog — port of the capture dialog in signals.tsx.
class _SignalDialog extends StatefulWidget {
  const _SignalDialog();

  @override
  State<_SignalDialog> createState() => _SignalDialogState();
}

class _SignalDialogState extends State<_SignalDialog> {
  final _title = TextEditingController();
  final _district = TextEditingController();
  final _province = TextEditingController();
  final _description = TextEditingController();
  String _type = 'unreported_death';
  String _channel = 'community';
  String _severity = 'medium';
  String? _facilityId;
  List<dynamic> _facilities = [];
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _loadFacilities();
  }

  Future<void> _loadFacilities() async {
    try {
      final res = await context.read<ApiClient>().get('/facilities');
      if (mounted) {
        setState(() => _facilities = (res['items'] as List?) ?? []);
      }
    } catch (_) {
      /* facility picker is optional */
    }
  }

  @override
  void dispose() {
    _title.dispose();
    _district.dispose();
    _province.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      throwIfFailed(
        await context.read<MutationService>().http(
          'POST',
          '/signals',
          body: {
            'title': _title.text.trim(),
            'signalType': _type,
            'sourceChannel': _channel,
            if (_district.text.trim().isNotEmpty)
              'district': _district.text.trim(),
            if (_province.text.trim().isNotEmpty)
              'province': _province.text.trim(),
            if (_facilityId != null) 'facilityId': _facilityId,
            'severity': _severity,
            if (_description.text.trim().isNotEmpty)
              'description': _description.text.trim(),
          },
          entityType: 'signal',
        ),
      );
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(tr('Capture signal')),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _title,
              decoration: InputDecoration(labelText: tr('Title')),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _type,
              decoration: InputDecoration(labelText: tr('Signal type')),
              items: [
                for (final e in kSignalTypeLabels.entries)
                  DropdownMenuItem(value: e.key, child: Text(tr(e.value))),
              ],
              onChanged: (v) => setState(() => _type = v ?? 'unreported_death'),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _channel,
              decoration: InputDecoration(labelText: tr('Source channel')),
              items: [
                for (final (v, l) in [
                  ('community', 'Community'),
                  ('vhw', 'Village Health Worker'),
                  ('facility', 'Facility'),
                  ('police', 'Police'),
                  ('media', 'Media'),
                  ('offline', 'Offline capture'),
                ])
                  DropdownMenuItem(value: v, child: Text(tr(l))),
              ],
              onChanged: (v) => setState(() => _channel = v ?? 'community'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _province,
              decoration: InputDecoration(labelText: tr('Province')),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _district,
              decoration: InputDecoration(labelText: tr('District')),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _facilityId,
              decoration: InputDecoration(labelText: tr('Facility (if known)')),
              items: [
                for (final f in _facilities.where(
                  (f) =>
                      _district.text.trim().isEmpty ||
                      '${f['district']}'.toLowerCase() ==
                          _district.text.trim().toLowerCase() ||
                      '${f['province']}'.toLowerCase() ==
                          _province.text.trim().toLowerCase(),
                ))
                  DropdownMenuItem(
                    value: '${f['facility_id']}',
                    child: Text(
                      '${f['facility_name']} — ${f['district']}',
                      style: const TextStyle(fontSize: 13),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: (v) => setState(() {
                _facilityId = v;
                final f = _facilities.firstWhere(
                  (x) => '${x['facility_id']}' == v,
                  orElse: () => null,
                );
                if (f != null) {
                  _district.text = '${f['district']}';
                  _province.text = '${f['province']}';
                }
              }),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _severity,
              decoration: InputDecoration(labelText: tr('Severity')),
              items: [
                for (final v in ['low', 'medium', 'high', 'critical'])
                  DropdownMenuItem(
                    value: v,
                    child: Text(tr(v[0].toUpperCase() + v.substring(1))),
                  ),
              ],
              onChanged: (v) => setState(() => _severity = v ?? 'medium'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _description,
              maxLines: 3,
              decoration: InputDecoration(labelText: tr('Description')),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(tr('Cancel')),
        ),
        FilledButton(
          onPressed: _saving || _title.text.trim().length < 2 ? null : _save,
          child: Text(tr('Capture')),
        ),
      ],
    );
  }
}
