import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../data/api_client.dart';
import '../../data/dds_repository.dart';
import '../../data/draft_store.dart';
import '../../data/models.dart';
import '../../data/sync_service.dart';
import '../../ui/app_shell.dart';
import '../../ui/theme.dart';
import '../../ui/translated_text.dart';
import '../../ui/widgets.dart';

import '../../l10n/app_localizations.dart';

/// Port of client/src/pages/pathology-queue.tsx — cases awaiting review.
class PathologyQueueScreen extends StatefulWidget {
  const PathologyQueueScreen({super.key});

  @override
  State<PathologyQueueScreen> createState() => _PathologyQueueScreenState();
}

class _PathologyQueueScreenState extends State<PathologyQueueScreen> {
  List<DeathNotification> _items = [];
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
      final items = await context.read<DdsRepository>().notifications();
      if (mounted) {
        setState(() {
          _items = items
              .where(
                (n) =>
                    n.status == 'pending_review' || n.status == 'under_review',
              )
              .toList();
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
      title: 'Pathology Review Queue',
      actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      child: _loading
          ? loadingOr(null)
          : _error != null
          ? loadingOr(_error, onRetry: _load)
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text(
                    tr('{n} case(s) awaiting review', {'n': _items.length}),
                    style: const TextStyle(
                      fontSize: 13,
                      color: DdsColors.mutedForeground,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (_items.isEmpty)
                    const Card(
                      child: EmptyState('The pathology queue is clear.'),
                    )
                  else
                    for (final n in _items)
                      Card(
                        margin: const EdgeInsets.only(bottom: 10),
                        child: ListTile(
                          title: Row(
                            children: [
                              Flexible(
                                child: Text(
                                  n.patientName,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                              if (n.isMaternalPerinatal) ...[
                                const SizedBox(width: 6),
                                const _MpdsrTag(),
                              ],
                            ],
                          ),
                          subtitle: Text(
                            '${n.preliminaryIcdCode} ${n.icdDescription}\n${n.facilityName} · ${fmtDate(n.dateOfDeath)}',
                            style: const TextStyle(fontSize: 11),
                          ),
                          isThreeLine: true,
                          trailing: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              StatusBadge(n.status),
                              const SizedBox(height: 4),
                              const Icon(
                                Icons.chevron_right,
                                size: 18,
                                color: DdsColors.mutedForeground,
                              ),
                            ],
                          ),
                          onTap: () => context.push(
                            '/pathology/review/${n.notificationId}',
                          ),
                        ),
                      ),
                ],
              ),
            ),
    );
  }
}

class _MpdsrTag extends StatelessWidget {
  const _MpdsrTag();
  @override
  Widget build(BuildContext context) => Container(
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
}

/// Port of client/src/pages/pathology-review.tsx — image viewer + autopsy
/// form (draft or finalize) with ICD autocomplete.
class PathologyReviewScreen extends StatefulWidget {
  const PathologyReviewScreen({super.key, required this.id});

  final String id;

  @override
  State<PathologyReviewScreen> createState() => _PathologyReviewScreenState();
}

class _PathologyReviewScreenState extends State<PathologyReviewScreen> {
  NotificationDetail? _detail;
  Object? _error;
  int _sel = 0;
  bool _uploading = false;
  String? _saving; // 'draft' | 'final'

  String internalObservations = '';
  String toxicologyResults = '';
  bool legalThresholdFlag = false;
  String finalIcdCode = '';
  String finalCauseOfDeath = '';
  String digitalSignature = '';
  List<IcdCode> _icdItems = [];

  bool get _canSubmit =>
      finalIcdCode.isNotEmpty &&
      finalCauseOfDeath.trim().isNotEmpty &&
      digitalSignature.trim().isNotEmpty;

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
      await _load();
    } on ApiException catch (e) {
      if (e.status == 0) {
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

  Future<void> _searchIcd(String q) async {
    if (q.isEmpty) {
      setState(() => _icdItems = []);
      return;
    }
    try {
      final items = await context.read<DdsRepository>().icdCodes(q);
      if (mounted) setState(() => _icdItems = items.take(6).toList());
    } catch (_) {
      /* ignore */
    }
  }

  Future<void> _save(bool finalize) async {
    setState(() => _saving = finalize ? 'final' : 'draft');
    try {
      await context.read<DdsRepository>().saveAutopsy(widget.id, {
        'internalObservations': internalObservations,
        'toxicologyResults': toxicologyResults,
        'legalThresholdFlag': legalThresholdFlag,
        'finalIcdCode': finalIcdCode,
        'finalCauseOfDeath': finalCauseOfDeath,
        'digitalSignature': digitalSignature,
      }, finalize: finalize);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            finalize
                ? tr('Autopsy finalized — certificate available.')
                : tr('Draft autopsy saved.'),
          ),
        ),
      );
      context.pushReplacement('/notifications/${widget.id}');
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _saving = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _detail;
    final n = d?.notification;
    final images = d?.images ?? [];

    return AppScaffold(
      title: 'Pathology Review',
      child: d == null
          ? loadingOr(_error, onRetry: _load)
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // Patient header
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                n!.patientName,
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 16,
                                ),
                              ),
                            ),
                            StatusBadge(n.status),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(
                          '${n.preliminaryIcdCode} ${n.icdDescription} · ${n.facilityName} · ${fmtDate(n.dateOfDeath)}',
                          style: const TextStyle(
                            fontSize: 12,
                            color: DdsColors.mutedForeground,
                          ),
                        ),
                        if (n.clinicalSummary != null) ...[
                          const SizedBox(height: 8),
                          TranslatedText(
                            n.clinicalSummary!,
                            pii: [
                              n.patientName,
                              if (n.nationalId != null) n.nationalId!,
                              n.facilityName,
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                // Image viewer — port of the zoomable viewer
                SectionCard(
                  title: '${tr('Specimen images')} (${images.length})',
                  trailing: OutlinedButton.icon(
                    onPressed: _uploading ? null : _pickAndUpload,
                    icon: const Icon(Icons.add_photo_alternate, size: 16),
                    label: Text(tr('Upload')),
                  ),
                  child: images.isEmpty
                      ? const EmptyState('No images uploaded yet.')
                      : Column(
                          children: [
                            ClipRRect(
                              borderRadius: BorderRadius.circular(8),
                              child: Container(
                                height: 300,
                                color: Colors.black87,
                                child: InteractiveViewer(
                                  maxScale: 8,
                                  child: Center(
                                    child: DdsNetImage(
                                      imageId:
                                          images[_sel.clamp(
                                                0,
                                                images.length - 1,
                                              )]
                                              .imageId,
                                      fit: BoxFit.contain,
                                    ),
                                  ),
                                ),
                              ),
                            ),
                            if (images.length > 1)
                              SizedBox(
                                height: 64,
                                child: ListView.builder(
                                  scrollDirection: Axis.horizontal,
                                  padding: const EdgeInsets.only(top: 8),
                                  itemCount: images.length,
                                  itemBuilder: (context, i) => GestureDetector(
                                    onTap: () => setState(() => _sel = i),
                                    child: Container(
                                      width: 80,
                                      margin: const EdgeInsets.only(right: 8),
                                      decoration: BoxDecoration(
                                        border: Border.all(
                                          color: i == _sel
                                              ? DdsColors.primary
                                              : DdsColors.border,
                                          width: i == _sel ? 2 : 1,
                                        ),
                                        borderRadius: BorderRadius.circular(6),
                                      ),
                                      clipBehavior: Clip.antiAlias,
                                      child: DdsNetImage(
                                        imageId: images[i].imageId,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                          ],
                        ),
                ),
                const SizedBox(height: 16),
                // Autopsy form
                SectionCard(
                  title: 'Autopsy findings',
                  subtitle: 'Record findings and certify the cause of death',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _area(
                        'Internal observations',
                        (v) => internalObservations = v,
                        initial: internalObservations,
                      ),
                      _area(
                        'Toxicology results',
                        (v) => toxicologyResults = v,
                        initial: toxicologyResults,
                      ),
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        dense: true,
                        value: legalThresholdFlag,
                        onChanged: (v) =>
                            setState(() => legalThresholdFlag = v == true),
                        title: Text(
                          tr('Legal threshold met (reportable to authorities)'),
                          style: TextStyle(fontSize: 13),
                        ),
                        controlAffinity: ListTileControlAffinity.leading,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        tr('Final ICD-10 code *'),
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      const SizedBox(height: 6),
                      TextField(
                        decoration: InputDecoration(
                          hintText: tr('Search ICD code…'),
                        ),
                        onChanged: (v) {
                          finalIcdCode = v;
                          _searchIcd(v);
                        },
                      ),
                      if (_icdItems.isNotEmpty)
                        Container(
                          margin: const EdgeInsets.only(top: 4),
                          constraints: const BoxConstraints(maxHeight: 180),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            border: Border.all(color: DdsColors.border),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: ListView.builder(
                            shrinkWrap: true,
                            itemCount: _icdItems.length,
                            itemBuilder: (context, i) {
                              final c = _icdItems[i];
                              return ListTile(
                                dense: true,
                                title: Text(
                                  '${c.icdCode} — ${c.description}',
                                  style: const TextStyle(fontSize: 13),
                                ),
                                onTap: () => setState(() {
                                  finalIcdCode = c.icdCode;
                                  _icdItems = [];
                                }),
                              );
                            },
                          ),
                        ),
                      const SizedBox(height: 14),
                      Text(
                        tr('Final cause of death *'),
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      const SizedBox(height: 6),
                      TextField(
                        decoration: InputDecoration(
                          hintText: tr(
                            'e.g. Acute severe cholera with dehydration',
                          ),
                        ),
                        onChanged: (v) => finalCauseOfDeath = v,
                      ),
                      const SizedBox(height: 14),
                      Text(
                        tr('Digital signature *'),
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      const SizedBox(height: 6),
                      TextField(
                        decoration: InputDecoration(
                          hintText: tr('Full name — certifies the report'),
                        ),
                        onChanged: (v) => digitalSignature = v,
                      ),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: _saving == null
                                  ? () => _save(false)
                                  : null,
                              icon: _saving == 'draft'
                                  ? const SizedBox(
                                      width: 14,
                                      height: 14,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                      ),
                                    )
                                  : const Icon(Icons.save_outlined, size: 16),
                              label: Text(tr('Save draft')),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: FilledButton.icon(
                              onPressed: _saving == null && _canSubmit
                                  ? () => _save(true)
                                  : null,
                              icon: _saving == 'final'
                                  ? const SizedBox(
                                      width: 14,
                                      height: 14,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Colors.white,
                                      ),
                                    )
                                  : const Icon(
                                      Icons.verified_outlined,
                                      size: 16,
                                    ),
                              label: Text(tr('Finalize')),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
              ],
            ),
    );
  }

  Widget _area(
    String label,
    ValueChanged<String> onChanged, {
    String initial = '',
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            tr(label),
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 6),
          TextFormField(
            initialValue: initial,
            maxLines: 3,
            onChanged: onChanged,
          ),
        ],
      ),
    );
  }
}
