import 'package:flutter/material.dart' hide InputDecoration, Text, TextSpan;
import 'package:dds_mobile/l10n/localized_widgets.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../data/auth_repository.dart';
import '../../data/dds_repository.dart';
import '../../data/draft_store.dart';
import '../../data/mutation_service.dart';
import '../../data/sync_service.dart';
import '../../ui/app_shell.dart';
import '../../ui/theme.dart';
import '../../ui/ai_summary.dart';
import '../../ui/translated_text.dart';
import '../../ui/widgets.dart';

import '../../l10n/app_localizations.dart';

/// Port of client/src/pages/notification-detail.tsx — patient details,
/// tele-pathology image gallery with upload, autopsy summary card.
class NotificationDetailScreen extends StatefulWidget {
  const NotificationDetailScreen({super.key, required this.id});

  final String id;

  @override
  State<NotificationDetailScreen> createState() =>
      _NotificationDetailScreenState();
}

class _NotificationDetailScreenState extends State<NotificationDetailScreen> {
  NotificationDetail? _detail;
  Map<String, dynamic>? _local;
  Map<String, dynamic>? _insights;
  Object? _error;
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final repo = context.read<DdsRepository>();
      final d = await repo.notification(widget.id);
      // Best-effort: the per-case intelligence summary is optional — a
      // failure never blocks the record itself.
      repo.caseInsights(widget.id).then((i) {
        if (mounted) setState(() => _insights = i);
      }).catchError((_) {});
      if (mounted) {
        setState(() {
          _detail = d;
          _local = null;
          _error = null;
        });
      }
    } catch (e) {
      // Not on the server — fall back to the local shadow record so a case
      // captured offline still opens (and shows it hasn't synced yet).
      final local = await _localRecord();
      if (mounted) {
        setState(() {
          _local = local;
          _error = local == null ? e : null;
        });
      }
    }
  }

  /// The `offline_cases` row for this id, when the notification was
  /// captured on-device and hasn't synced yet.
  Future<Map<String, dynamic>?> _localRecord() async {
    final reports = await OfflineCaseStore.localReports();
    for (final r in reports) {
      if (r['local_id'] == widget.id && r['kind'] == 'notification') {
        return r;
      }
    }
    return null;
  }

  Future<void> _pickAndUpload() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 85,
    );
    if (picked == null || !mounted) return;
    setState(() => _uploading = true);
    try {
      // MutationService sends inline when online and queues the upload
      // (encrypted, file path retained) when not.
      final res = await context.read<MutationService>().upload(
        '/notifications/${widget.id}/images',
        picked.path,
        entityType: 'death_notification',
        entityId: widget.id,
      );
      if (!mounted) return;
      context.read<SyncService>().refreshPending();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            switch (res.status) {
              MutationStatus.synced => tr(
                'Image uploaded and hashed to case.',
              ),
              MutationStatus.queued => tr(
                'Offline — image queued and will upload when back online.',
              ),
              MutationStatus.conflict => tr(
                'Upload conflicted with a newer server version.',
              ),
              MutationStatus.rejected =>
                res.error?.message ?? tr('Upload failed'),
            },
          ),
        ),
      );
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthRepository>().user;
    final canUpload =
        user != null &&
        const [
          'medical_officer',
          'pathologist',
          'public_health_analyst',
        ].contains(user.role);
    final n = _detail?.notification;

    return AppScaffold(
      title: tr('Notification Detail'),
      child: _detail == null
          ? (_local != null ? _localView(_local!) : loadingOr(_error, onRetry: _load))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (_insights != null) _insightsCard(),
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
                                  n!.patientName,
                                  style: const TextStyle(
                                    fontSize: 17,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                              if (n.isMaternalPerinatal)
                                const Padding(
                                  padding: EdgeInsets.only(right: 6),
                                  child: _MpdsrBadge(),
                                ),
                              StatusBadge(n.status),
                            ],
                          ),
                          const SizedBox(height: 14),
                          InfoRow(tr('National ID'), n.nationalId ?? '—'),
                          InfoRow(
                            tr('Age / Gender'),
                            '${n.age ?? '—'} / ${tr(n.gender)}',
                          ),
                          InfoRow(tr('Address'), n.residentialAddress ?? '—'),
                          InfoRow(
                            tr('Date of death'),
                            fmtDateTime(n.dateOfDeath),
                          ),
                          InfoRow(
                            tr('Preliminary ICD'),
                            '${n.preliminaryIcdCode} — ${n.icdDescription}',
                          ),
                          InfoRow(tr('Category'), n.diseaseCategory),
                          InfoRow(
                            tr('Facility'),
                            '${n.facilityName}, ${n.district}',
                          ),
                          InfoRow(
                            tr('Reported by'),
                            '${n.reportedByName} · ${fmtDate(n.createdAt)}',
                          ),
                          if (n.assignedTo != null) ...[
                            InfoRow(tr('Assigned to'), n.assigneeName ?? '—'),
                            if (n.reviewDueAt != null)
                              InfoRow(
                                tr('Review due'),
                                '${fmtDateTime(n.reviewDueAt)}${n.overdue ? ' (overdue)' : ''}',
                              ),
                          ],
                          if (n.rejectionReason != null &&
                              n.rejectionReason!.isNotEmpty) ...[
                            InfoRow(tr('Rejection reason'), n.rejectionReason!),
                            if (n.rejectedAt != null)
                              InfoRow(
                                tr('Rejected at'),
                                fmtDateTime(n.rejectedAt!),
                              ),
                          ],
                          if (n.clinicalSummary != null &&
                              n.clinicalSummary!.isNotEmpty) ...[
                            const SizedBox(height: 4),
                            Text(
                              tr('Clinical summary'),
                              style: TextStyle(
                                fontSize: 12,
                                color: DdsColors.mutedForeground,
                              ),
                            ),
                            const SizedBox(height: 2),
                            TranslatedText(
                              n.clinicalSummary!,
                              pii: [
                                n.patientName,
                                if (n.nationalId != null) n.nationalId!,
                                if (n.residentialAddress != null)
                                  n.residentialAddress!,
                                n.facilityName,
                                n.reportedByName,
                              ],
                            ),
                            AiSummary(
                              n.clinicalSummary!,
                              pii: [
                                n.patientName,
                                if (n.nationalId != null) n.nationalId!,
                                if (n.residentialAddress != null)
                                  n.residentialAddress!,
                                n.facilityName,
                                n.reportedByName,
                              ],
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  SectionCard(
                    title:
                        '${tr('Tele-pathology images')} (${_detail!.images.length})',
                    trailing: canUpload
                        ? OutlinedButton.icon(
                            onPressed: _uploading ? null : _pickAndUpload,
                            icon: _uploading
                                ? const SizedBox(
                                    width: 14,
                                    height: 14,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(
                                    Icons.add_photo_alternate,
                                    size: 16,
                                  ),
                            label: Text(tr('Upload')),
                          )
                        : null,
                    child: _detail!.images.isEmpty
                        ? EmptyState(tr('No pathology images uploaded yet.'))
                        : GridView.count(
                            crossAxisCount:
                                MediaQuery.of(context).size.width > 700 ? 3 : 2,
                            shrinkWrap: true,
                            physics: const NeverScrollableScrollPhysics(),
                            mainAxisSpacing: 10,
                            crossAxisSpacing: 10,
                            childAspectRatio: 1.5,
                            children: [
                              for (final img in _detail!.images)
                                ClipRRect(
                                  borderRadius: BorderRadius.circular(8),
                                  child: Container(
                                    color: Colors.black87,
                                    child: DdsNetImage(imageId: img.imageId),
                                  ),
                                ),
                            ],
                          ),
                  ),
                  const SizedBox(height: 16),
                  SectionCard(
                    title: tr('Autopsy report'),
                    child: _detail!.autopsy == null
                        ? EmptyState(tr('No autopsy report yet.'))
                        : Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    tr('Status'),
                                    style: TextStyle(
                                      color: DdsColors.mutedForeground,
                                    ),
                                  ),
                                  StatusBadge(_detail!.autopsy!.status),
                                ],
                              ),
                              const SizedBox(height: 8),
                              InfoRow(
                                tr('Pathologist'),
                                _detail!.autopsy!.pathologistName ?? '—',
                              ),
                              if (_detail!.autopsy!.finalIcdCode != null)
                                InfoRow(
                                  tr('Final ICD'),
                                  _detail!.autopsy!.finalIcdCode!,
                                ),
                              if (_detail!.autopsy!.legalThresholdFlag)
                                const Padding(
                                  padding: EdgeInsets.only(bottom: 8),
                                  child: _LegalFlag(),
                                ),
                              OutlinedButton(
                                onPressed: () => context.push(
                                  '/autopsy/${_detail!.autopsy!.autopsyId}',
                                ),
                                child: Text(tr('View report')),
                              ),
                            ],
                          ),
                  ),
                  if (_detail!.certification != null) ...[
                    const SizedBox(height: 16),
                    SectionCard(
                      title: tr('Medical certification'),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          InfoRow(
                            tr('Certified by'),
                            _detail!.certification!.certifiedByName,
                          ),
                          InfoRow(
                            tr('Manner of death'),
                            _detail!.certification!.mannerOfDeath,
                          ),
                          InfoRow(
                            tr('Final ICD'),
                            _detail!.certification!.finalIcdCode,
                          ),
                          InfoRow(
                            tr('Cause of death'),
                            _detail!.certification!.finalCauseOfDeath,
                          ),
                        ],
                      ),
                    ),
                  ],
                  if (n.status == 'certified' || n.status == 'finalized') ...[
                    const SizedBox(height: 16),
                    SectionCard(
                      title: tr('Death certificate'),
                      child: Text(
                        tr(
                          'A printable death certificate is available for this case.',
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 24),
                ],
              ),
            ),
    );
  }

  /// Detail view for a record captured on this device that hasn't synced —
  /// renders straight from the `offline_cases` shadow row.
  Widget _localView(Map<String, dynamic> r) {
    final d = (r['data'] as Map?)?.cast<String, dynamic>() ?? const {};
    final p = (d['patient'] as Map?)?.cast<String, dynamic>() ?? const {};
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: const Color(0xFFFEF3C7),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Row(
            children: [
              const Icon(
                Icons.cloud_upload_outlined,
                size: 16,
                color: Color(0xFF92400E),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  tr(
                    'Recorded on this device — will sync when a connection is available.',
                  ),
                  style: const TextStyle(
                    fontSize: 12,
                    color: Color(0xFF92400E),
                  ),
                ),
              ),
              const StatusBadge('pending_sync'),
            ],
          ),
        ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  p['fullName']?.toString() ?? '—',
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 14),
                InfoRow(tr('National ID'), p['nationalId']?.toString() ?? '—'),
                InfoRow(
                  tr('Age / Gender'),
                  '${p['age'] ?? '—'} / ${tr(p['gender']?.toString() ?? '')}',
                ),
                InfoRow(
                  tr('Address'),
                  p['residentialAddress']?.toString() ?? '—',
                ),
                InfoRow(
                  tr('Date of death'),
                  fmtDateTime(d['dateOfDeath']?.toString()),
                ),
                InfoRow(
                  tr('Preliminary ICD'),
                  d['preliminaryIcdCode']?.toString() ?? '—',
                ),
                if (d['clinicalSummary']?.toString().isNotEmpty == true)
                  InfoRow(
                    tr('Clinical summary'),
                    d['clinicalSummary'].toString(),
                  ),
                InfoRow(
                  tr('Queued'),
                  fmtDateTime(r['queuedAt']?.toString()),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// System Intelligence Summary — the server-written per-objective
  /// interpretation, identical strings to the web card.
  Widget _insightsCard() {
    final items = (_insights?['insights'] as List? ?? []);
    return Card(
      color: const Color(0xFFEFF6FF),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: Color(0xFFBFDBFE)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              tr('System Intelligence Summary'),
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
            ),
            const SizedBox(height: 8),
            for (final i in items)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${i['label']}',
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: Colors.black54,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${i['text']}',
                      style: const TextStyle(fontSize: 13, height: 1.35),
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

class _MpdsrBadge extends StatelessWidget {
  const _MpdsrBadge();
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: const Color(0xFFFEE2E2),
      borderRadius: BorderRadius.circular(999),
      border: Border.all(color: const Color(0xFFFCA5A5)),
    ),
    child: Text(
      tr('MPDSR'),
      style: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w700,
        color: DdsColors.destructive,
      ),
    ),
  );
}

class _LegalFlag extends StatelessWidget {
  const _LegalFlag();
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    decoration: BoxDecoration(
      color: const Color(0xFFFEE2E2),
      borderRadius: BorderRadius.circular(8),
    ),
    child: Text(
      tr('Legal threshold flagged'),
      style: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w600,
        color: DdsColors.destructive,
      ),
    ),
  );
}
