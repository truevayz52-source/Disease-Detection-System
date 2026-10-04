import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../data/auth_repository.dart';
import '../../data/api_client.dart';
import '../../data/dds_repository.dart';
import '../../data/draft_store.dart';
import '../../data/sync_service.dart';
import '../../ui/app_shell.dart';
import '../../ui/theme.dart';
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
  Object? _error;
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await context.read<DdsRepository>().notification(widget.id);
      if (mounted) {
        setState(() {
          _detail = d;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _pickAndUpload() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 85,
    );
    if (picked == null || !mounted) return;
    setState(() => _uploading = true);
    try {
      await context.read<DdsRepository>().uploadImage(widget.id, picked.path);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(tr('Image uploaded and hashed to case.'))),
        );
      }
      await _load();
    } on ApiException catch (e) {
      if (e.status == 0) {
        // Offline — keep the file path and replay the upload on reconnect.
        await OfflineQueue().enqueueImage(widget.id, picked.path);
        if (mounted) {
          context.read<SyncService>().refreshPending();
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                tr('Offline — image queued and will upload when back online.'),
              ),
            ),
          );
        }
      } else if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
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
          'system_admin',
        ].contains(user.role);
    final n = _detail?.notification;

    return AppScaffold(
      title: 'Notification Detail',
      child: _detail == null
          ? loadingOr(_error, onRetry: _load)
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
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
                          InfoRow('National ID', n.nationalId ?? '—'),
                          InfoRow(
                            'Age / Gender',
                            '${n.age ?? '—'} / ${tr(n.gender)}',
                          ),
                          InfoRow('Address', n.residentialAddress ?? '—'),
                          InfoRow('Date of death', fmtDateTime(n.dateOfDeath)),
                          InfoRow(
                            'Preliminary ICD',
                            '${n.preliminaryIcdCode} — ${n.icdDescription}',
                          ),
                          InfoRow('Category', n.diseaseCategory),
                          InfoRow(
                            'Facility',
                            '${n.facilityName}, ${n.district}',
                          ),
                          InfoRow(
                            'Reported by',
                            '${n.reportedByName} · ${fmtDate(n.createdAt)}',
                          ),
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
                        ? const EmptyState('No pathology images uploaded yet.')
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
                    title: 'Autopsy report',
                    child: _detail!.autopsy == null
                        ? const EmptyState('No autopsy report yet.')
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
                                'Pathologist',
                                _detail!.autopsy!.pathologistName ?? '—',
                              ),
                              if (_detail!.autopsy!.finalIcdCode != null)
                                InfoRow(
                                  'Final ICD',
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
                  const SizedBox(height: 24),
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
