import 'package:flutter/material.dart' hide InputDecoration, Text, TextSpan;
import 'package:dds_mobile/l10n/localized_widgets.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../data/auth_repository.dart';
import '../../data/dds_repository.dart';
import '../../data/draft_store.dart';
import '../../data/models.dart';
import '../../data/mutation_service.dart';
import '../../ui/app_shell.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

import '../../l10n/app_localizations.dart';

/// Port of client/src/pages/notifications.tsx — stat cards, search/filter
/// toolbar, MPDSR toggle and the records list.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<DeathNotification> _items = [];
  List<DeathNotification> _localPending = [];
  bool _loading = true;
  Object? _error;

  String _q = '';
  String _status = 'all';
  String _district = 'all';
  bool _mpdsrOnly = false;
  bool _newestFirst = true;

  MutationService? _mutations;

  @override
  void initState() {
    super.initState();
    _load();
    // Re-merge whenever the mutation layer writes/queues/clears ops so the
    // pending rows appear and disappear without a manual refresh.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _mutations = context.read<MutationService>()..addListener(_load);
    });
  }

  @override
  void dispose() {
    _mutations?.removeListener(_load);
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    // Locally captured records that haven't synced yet render inline —
    // optimistic UI: a case filed offline never looks lost.
    final repo = context.read<DdsRepository>();
    final pending = await _pendingLocalRows();
    try {
      final items = await repo.notifications(
        q: _q,
        status: _status,
        district: _district,
      );
      if (mounted) {
        setState(() {
          _items = items;
          _localPending = pending;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _localPending = pending;
          // Keep showing local records even when the server read fails —
          // an empty list offline would look like data loss.
          _error = pending.isEmpty ? e : null;
          _loading = false;
        });
      }
    }
  }

  /// PENDING `offline_cases` notification records as list rows.
  Future<List<DeathNotification>> _pendingLocalRows() async {
    final reports = await OfflineCaseStore.pending();
    return [
      for (final r in reports)
        if (r['kind'] == 'notification')
          _localRow(r['local_id']?.toString() ?? '', r),
    ];
  }

  static DeathNotification _localRow(String id, Map<String, dynamic> r) {
    final d = (r['data'] as Map?)?.cast<String, dynamic>() ?? const {};
    final p = (d['patient'] as Map?)?.cast<String, dynamic>() ?? const {};
    return DeathNotification(
      notificationId: id,
      patientId: '',
      patientName: p['fullName']?.toString() ?? '',
      nationalId: p['nationalId']?.toString(),
      age: (p['age'] as num?)?.toInt(),
      gender: p['gender']?.toString() ?? '',
      residentialAddress: p['residentialAddress']?.toString(),
      facilityId: d['facilityId']?.toString() ?? '',
      facilityName: tr('Saved on this device'),
      district: '',
      province: '',
      dateOfDeath: d['dateOfDeath']?.toString() ?? '',
      preliminaryIcdCode: d['preliminaryIcdCode']?.toString() ?? '',
      icdDescription: '',
      diseaseCategory: '',
      clinicalSummary: d['clinicalSummary']?.toString(),
      status: 'pending_sync',
      isMaternalPerinatal: d['isMaternalPerinatal'] == true,
      reportedByName: tr('This device'),
      createdAt: r['queuedAt']?.toString() ?? '',
    );
  }

  List<DeathNotification> get _filtered {
    final list = _items
        .where((n) => !_mpdsrOnly || n.isMaternalPerinatal)
        .toList();
    list.sort((a, b) {
      final da = DateTime.tryParse(a.dateOfDeath) ?? DateTime(1970);
      final db = DateTime.tryParse(b.dateOfDeath) ?? DateTime(1970);
      return _newestFirst ? db.compareTo(da) : da.compareTo(db);
    });
    return list;
  }

  List<String> get _districts =>
      [..._items.map((n) => n.district).where((d) => d.isNotEmpty).toSet()]
        ..sort();

  @override
  Widget build(BuildContext context) {
    final role = context.watch<AuthRepository>().user?.role;
    final canCreate = const [
      'medical_officer',
      'mortuary_clerk',
    ].contains(role);
    final items = [..._localPending, ..._filtered];
    final pending = _items.where((n) => n.status == 'pending_review').length;
    final underReview = _items.where((n) => n.status == 'under_review').length;
    final finalized = _items
        .where((n) => n.status == 'finalized' || n.status == 'autopsy_complete')
        .length;
    final mpdsr = _items.where((n) => n.isMaternalPerinatal).length;

    return AppScaffold(
      title: tr('Death Notifications'),
      actions: [
        if (canCreate)
          IconButton(
            tooltip: tr('New notification'),
            onPressed: () => context.push('/notifications/new'),
            icon: const Icon(Icons.add_circle_outline),
          ),
        IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
      ],
      child: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            // stats
            SizedBox(
              height: 74,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  _miniStat(
                    tr('Records shown'),
                    _items.length,
                    Icons.assignment_outlined,
                    DdsColors.accentBlue,
                  ),
                  _miniStat(
                    tr('Pending review'),
                    pending,
                    Icons.hourglass_top_outlined,
                    DdsColors.accentAmber,
                  ),
                  _miniStat(
                    tr('Under review'),
                    underReview,
                    Icons.biotech_outlined,
                    DdsColors.accentPurple,
                  ),
                  _miniStat(
                    tr('Finalized'),
                    finalized,
                    Icons.fact_check_outlined,
                    DdsColors.accentEmerald,
                  ),
                  _miniStat(
                    tr('MPDSR cases'),
                    mpdsr,
                    Icons.child_care_outlined,
                    DdsColors.accentRed,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            // toolbar
            TextField(
              decoration: InputDecoration(
                prefixIcon: Icon(Icons.search, size: 18),
                hintText: tr('Search patient or national ID…'),
                isDense: true,
              ),
              onChanged: (v) {
                _q = v;
                _load();
              },
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                _dropdown(
                  value: _status,
                  items: {
                    'all': tr('All statuses'),
                    'pending_review': tr('Pending review'),
                    'under_review': tr('Under review'),
                    'autopsy_complete': tr('Autopsy complete'),
                    'finalized': tr('Finalized'),
                  },
                  onChanged: (v) {
                    setState(() => _status = v!);
                    _load();
                  },
                ),
                _dropdown(
                  value: _district,
                  items: {
                    'all': tr('All districts'),
                    for (final d in _districts) d: d,
                  },
                  onChanged: (v) {
                    setState(() => _district = v!);
                    _load();
                  },
                ),
                _dropdown(
                  value: _newestFirst ? 'newest' : 'oldest',
                  items: {
                    'newest': tr('Newest first'),
                    'oldest': tr('Oldest first'),
                  },
                  onChanged: (v) =>
                      setState(() => _newestFirst = v == 'newest'),
                ),
                FilterChip(
                  label: Text(tr('MPDSR only'), style: TextStyle(fontSize: 12)),
                  selected: _mpdsrOnly,
                  onSelected: (v) => setState(() => _mpdsrOnly = v),
                  selectedColor: const Color(0xFFFEE2E2),
                  checkmarkColor: DdsColors.destructive,
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              tr('{n} record(s)', {'n': items.length}),
              style: const TextStyle(
                fontSize: 12,
                color: DdsColors.mutedForeground,
              ),
            ),
            const SizedBox(height: 8),
            // records
            Card(
              clipBehavior: Clip.antiAlias,
              child: _loading
                  ? loadingOr(null)
                  : _error != null
                  ? loadingOr(_error, onRetry: _load)
                  : items.isEmpty
                  ? EmptyState(tr('No notifications match your filters.'))
                  : Column(
                      children: [
                        for (final n in items)
                          Column(
                            children: [
                              ListTile(
                                title: Row(
                                  children: [
                                    Flexible(
                                      child: Text(
                                        n.patientName,
                                        overflow: TextOverflow.ellipsis,
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w600,
                                          fontSize: 14,
                                        ),
                                      ),
                                    ),
                                    if (n.isMaternalPerinatal) ...[
                                      const SizedBox(width: 6),
                                      const _MpdsrChip(),
                                    ],
                                  ],
                                ),
                                subtitle: Text(
                                  '${n.preliminaryIcdCode} ${n.icdDescription}\n${n.facilityName} · ${n.district} · ${fmtDate(n.dateOfDeath)}',
                                  style: const TextStyle(fontSize: 11),
                                ),
                                isThreeLine: true,
                                trailing: StatusBadge(n.status),
                                onTap: () => context.push(
                                  '/notifications/${n.notificationId}',
                                ),
                              ),
                              const Divider(height: 1),
                            ],
                          ),
                      ],
                    ),
            ),
            const SizedBox(height: 80),
          ],
        ),
      ),
    );
  }

  Widget _miniStat(String label, int value, IconData icon, Color color) {
    return Container(
      width: 150,
      margin: const EdgeInsets.only(right: 10),
      child: StatCard(
        label: label,
        value: value,
        icon: icon,
        color: color,
        compact: true,
      ),
    );
  }

  Widget _dropdown({
    required String value,
    required Map<String, String> items,
    required ValueChanged<String?> onChanged,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFF94A3B8)),
        borderRadius: BorderRadius.circular(8),
      ),
      child: DropdownButton<String>(
        value: items.containsKey(value) ? value : 'all',
        items: [
          for (final e in items.entries)
            DropdownMenuItem(
              value: e.key,
              child: Text(tr(e.value), style: const TextStyle(fontSize: 12)),
            ),
        ],
        onChanged: onChanged,
        underline: const SizedBox.shrink(),
        isDense: true,
      ),
    );
  }
}

class _MpdsrChip extends StatelessWidget {
  const _MpdsrChip();

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
