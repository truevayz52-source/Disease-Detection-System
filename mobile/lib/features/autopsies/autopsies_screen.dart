import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../data/auth_repository.dart';
import '../../data/dds_repository.dart';
import '../../data/models.dart';
import '../../ui/app_shell.dart';
import '../../ui/theme.dart';
import '../../ui/translated_text.dart';
import '../../ui/widgets.dart';

import '../../l10n/app_localizations.dart';

/// Port of client/src/pages/autopsies.tsx
class AutopsiesScreen extends StatefulWidget {
  const AutopsiesScreen({super.key});

  @override
  State<AutopsiesScreen> createState() => _AutopsiesScreenState();
}

class _AutopsiesScreenState extends State<AutopsiesScreen> {
  List<AutopsyReport> _items = [];
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
      final items = await context.read<DdsRepository>().autopsies();
      if (mounted) {
        setState(() {
          _items = items;
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
      title: 'Autopsy Reports',
      actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      child: _loading
          ? loadingOr(null)
          : _error != null
          ? loadingOr(_error, onRetry: _load)
          : RefreshIndicator(
              onRefresh: _load,
              child: _items.isEmpty
                  ? ListView(
                      children: const [
                        SizedBox(height: 80),
                        EmptyState('No autopsy reports yet.'),
                      ],
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _items.length,
                      itemBuilder: (context, i) {
                        final a = _items[i];
                        return Card(
                          margin: const EdgeInsets.only(bottom: 10),
                          child: ListTile(
                            title: Text(
                              a.patientName ?? a.notificationId,
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            subtitle: Text(
                              '${a.facilityName ?? ''} ${a.district ?? ''}\n${a.finalIcdCode ?? '—'} · ${a.pathologistName ?? '—'}',
                              style: const TextStyle(fontSize: 11),
                            ),
                            isThreeLine: true,
                            trailing: StatusBadge(a.status),
                            onTap: () =>
                                context.push('/autopsy/${a.autopsyId}'),
                          ),
                        );
                      },
                    ),
            ),
    );
  }
}

/// Port of client/src/pages/autopsy-detail.tsx — report view + finalize.
class AutopsyDetailScreen extends StatefulWidget {
  const AutopsyDetailScreen({super.key, required this.id});

  final String id;

  @override
  State<AutopsyDetailScreen> createState() => _AutopsyDetailScreenState();
}

class _AutopsyDetailScreenState extends State<AutopsyDetailScreen> {
  AutopsyReport? _a;
  Object? _error;
  bool _finalizing = false;

  /// Record literals masked before text leaves the device for translation.
  List<String> _recordPii(AutopsyReport a) => [
    if (a.patientName != null) a.patientName!,
    if (a.facilityName != null) a.facilityName!,
    if (a.district != null) a.district!,
    if (a.pathologistName != null) a.pathologistName!,
    if (a.digitalSignature != null) a.digitalSignature!,
  ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final a = await context.read<DdsRepository>().autopsy(widget.id);
      if (mounted) {
        setState(() {
          _a = a;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _finalize() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(tr('Finalize autopsy?')),
        content: Text(
          tr(
            'Finalizing locks the report, applies the digital signature and enables the death certificate.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(tr('Cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(tr('Finalize')),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _finalizing = true);
    try {
      await context.read<DdsRepository>().finalizeAutopsy(widget.id);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(tr('Autopsy finalized.'))));
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _finalizing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final role = context.watch<AuthRepository>().user?.role;
    final canFinalize = const ['pathologist', 'system_admin'].contains(role);
    final a = _a;

    return AppScaffold(
      title: 'Autopsy Report',
      child: a == null
          ? loadingOr(_error, onRetry: _load)
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                a.patientName ?? tr('Autopsy report'),
                                style: const TextStyle(
                                  fontSize: 17,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                            StatusBadge(a.status),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          tr('Created {ts} · Report {id}', {
                            'ts': fmtDate(a.createdAt),
                            'id': a.autopsyId,
                          }),
                          style: const TextStyle(
                            fontSize: 11,
                            color: DdsColors.mutedForeground,
                          ),
                        ),
                        const SizedBox(height: 14),
                        InfoRow('Pathologist', a.pathologistName ?? '—'),
                        InfoRow(
                          'Facility',
                          '${a.facilityName ?? '—'}${a.district != null ? ', ${a.district}' : ''}',
                        ),
                        InfoRow('Final ICD', a.finalIcdCode ?? '—'),
                        if (a.finalCauseOfDeath != null) ...[
                          Text(
                            tr('Cause of death'),
                            style: const TextStyle(
                              fontSize: 12,
                              color: DdsColors.mutedForeground,
                            ),
                          ),
                          TranslatedText(
                            a.finalCauseOfDeath!,
                            pii: [
                              if (a.patientName != null) a.patientName!,
                              if (a.facilityName != null) a.facilityName!,
                              if (a.pathologistName != null) a.pathologistName!,
                            ],
                          ),
                          const SizedBox(height: 8),
                        ],
                        if (a.legalThresholdFlag)
                          Padding(
                            padding: EdgeInsets.only(bottom: 8),
                            child: Text(
                              tr('Legal threshold flagged'),
                              style: TextStyle(
                                color: DdsColors.destructive,
                                fontWeight: FontWeight.w600,
                                fontSize: 12,
                              ),
                            ),
                          ),
                        if (a.finalizedAt != null)
                          InfoRow('Finalized', fmtDateTime(a.finalizedAt)),
                        if (a.digitalSignature != null)
                          InfoRow('Signature', a.digitalSignature!),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                if (a.internalObservations != null &&
                    a.internalObservations!.isNotEmpty)
                  SectionCard(
                    title: 'Internal observations',
                    child: TranslatedText(
                      a.internalObservations!,
                      pii: _recordPii(a),
                    ),
                  ),
                if (a.toxicologyResults != null &&
                    a.toxicologyResults!.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  SectionCard(
                    title: 'Toxicology results',
                    child: TranslatedText(
                      a.toxicologyResults!,
                      pii: _recordPii(a),
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                if (a.status != 'finalized' && canFinalize)
                  FilledButton.icon(
                    onPressed: _finalizing ? null : _finalize,
                    icon: _finalizing
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.verified_outlined, size: 16),
                    label: Text(tr('Finalize report')),
                  ),
                const SizedBox(height: 24),
              ],
            ),
    );
  }
}
