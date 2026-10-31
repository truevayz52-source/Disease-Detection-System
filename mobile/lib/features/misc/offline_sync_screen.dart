import 'package:flutter/material.dart' hide InputDecoration, Text, TextSpan;
import 'package:dds_mobile/l10n/localized_widgets.dart';
import 'package:provider/provider.dart';

import '../../data/draft_store.dart';
import '../../data/mutation_service.dart';
import '../../data/sync_service.dart';
import '../../ui/app_shell.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

import '../../l10n/app_localizations.dart';

/// Port of client/src/pages/offline-sync.tsx — shows pending offline
/// mutations and triggers a manual sync. v2 adds per-op attempt counts and
/// errors, a conflicts section for last-write-wins losers, and discard.
class OfflineSyncScreen extends StatefulWidget {
  const OfflineSyncScreen({super.key});

  @override
  State<OfflineSyncScreen> createState() => _OfflineSyncScreenState();
}

class _OfflineSyncScreenState extends State<OfflineSyncScreen> {
  List<QueuedItem> _items = const [];
  List<Map<String, dynamic>> _resolved = const [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final items = await OfflineQueue().entries();
    final reports = await OfflineCaseStore.localReports();
    if (mounted) {
      setState(() {
        _items = items;
        _resolved = reports
            .where(
              (r) =>
                  r['sync_status'] == 'CONFLICT' ||
                  r['sync_status'] == 'REJECTED',
            )
            .toList();
        _loading = false;
      });
    }
  }

  IconData _iconFor(QueuedItem item) => switch (item.kind) {
    'multipart' => Icons.photo_outlined,
    'http' => Icons.edit_note_outlined,
    _ => Icons.assignment_outlined,
  };

  @override
  Widget build(BuildContext context) {
    final sync = context.watch<SyncService>();
    return AppScaffold(
      title: tr('Offline Sync'),
      actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      child: _loading
          ? loadingOr(null)
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        Icon(
                          sync.isOnline
                              ? Icons.cloud_done_outlined
                              : Icons.wifi_off,
                          color: sync.isOnline
                              ? DdsColors.success
                              : DdsColors.severityHigh,
                          size: 36,
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                sync.isOnline ? tr('Online') : tr('Offline'),
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 15,
                                ),
                              ),
                              Text(
                                tr('{n} pending item(s)', {
                                      'n': _items.length,
                                    }) +
                                    (sync.lastSyncAt != null
                                        ? ' · ${tr('last sync {ts}', {'ts': fmtDateTime(sync.lastSyncAt!.toIso8601String())})}'
                                        : ''),
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: DdsColors.mutedForeground,
                                ),
                              ),
                            ],
                          ),
                        ),
                        FilledButton.icon(
                          onPressed:
                              sync.isOnline &&
                                  !sync.syncing &&
                                  !sync.needsReauth
                              ? () async {
                                  await context.read<SyncService>().syncNow();
                                  await _load();
                                }
                              : null,
                          icon: sync.syncing
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Colors.white,
                                  ),
                                )
                              : const Icon(Icons.sync, size: 16),
                          label: Text(tr('Sync now')),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                if (sync.needsReauth)
                  Card(
                    color: const Color(0xFFFEF3C7),
                    margin: const EdgeInsets.only(bottom: 12),
                    child: Padding(
                      padding: EdgeInsets.all(12),
                      child: Row(
                        children: [
                          Icon(
                            Icons.lock_clock_outlined,
                            size: 18,
                            color: Color(0xFF92400E),
                          ),
                          SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              tr(
                                'Session expired — sign in again to sync pending item(s). Nothing has been lost; the queue is kept.',
                              ),
                              style: TextStyle(
                                fontSize: 12,
                                color: Color(0xFF92400E),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                // Conflicts + rejections — LWW losers kept for audit.
                if (_resolved.isNotEmpty) ...[
                  Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Text(
                      tr('Needs attention'),
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  for (final r in _resolved)
                    Card(
                      color: r['sync_status'] == 'CONFLICT'
                          ? const Color(0xFFFFF7ED)
                          : const Color(0xFFFEF2F2),
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        leading: Icon(
                          r['sync_status'] == 'CONFLICT'
                              ? Icons.merge_type_outlined
                              : Icons.error_outline,
                          color: r['sync_status'] == 'CONFLICT'
                              ? const Color(0xFF9A3412)
                              : DdsColors.destructive,
                        ),
                        title: Text(
                          r['kind'] == 'notification'
                              ? tr('Death notification — {name}', {
                                  'name':
                                      (r['data'] as Map?)?['patient']
                                          ?['fullName'] ??
                                      tr('unknown patient'),
                                })
                              : '${r['method'] ?? ''} ${r['path'] ?? ''}'
                                    .trim(),
                          style: const TextStyle(fontSize: 13),
                        ),
                        subtitle: Text(
                          '${tr(kStatusLabels[r['sync_status'] == 'CONFLICT' ? 'conflict' : 'rejected'] ?? 'Rejected')} · ${fmtDateTime(r['resolvedAt']?.toString())}'
                          '${r['lastError'] != null ? '\n${r['lastError']}' : ''}',
                          style: const TextStyle(fontSize: 11),
                        ),
                        isThreeLine: r['lastError'] != null,
                      ),
                    ),
                  const SizedBox(height: 8),
                ],
                if (_items.isEmpty)
                  Card(
                    child: EmptyState(
                      tr('Nothing queued — all changes are synced.'),
                    ),
                  )
                else
                  for (final item in _items)
                    Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        leading: Icon(
                          _iconFor(item),
                          color: DdsColors.primary,
                        ),
                        title: Text(
                          item.describe(),
                          style: const TextStyle(fontSize: 13),
                        ),
                        subtitle: Text(
                          tr('Queued {ts}', {
                                'ts': fmtDateTime(
                                  item.queuedAt.toIso8601String(),
                                ),
                              }) +
                              (item.attempts > 0
                                  ? ' · ${tr('{n} attempt(s)', {'n': item.attempts})}'
                                  : '') +
                              (item.lastError != null
                                  ? '\n${item.lastError}'
                                  : ''),
                          style: const TextStyle(fontSize: 11),
                        ),
                        isThreeLine: item.lastError != null,
                        trailing: IconButton(
                          tooltip: tr('Discard'),
                          icon: const Icon(
                            Icons.delete_outline,
                            size: 18,
                            color: DdsColors.mutedForeground,
                          ),
                          onPressed: () async {
                            await context.read<MutationService>().discard(
                              item.id,
                            );
                            await _load();
                          },
                        ),
                      ),
                    ),
                const SizedBox(height: 24),
              ],
            ),
    );
  }
}
