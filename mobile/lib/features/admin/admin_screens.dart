import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../data/dds_repository.dart';
import '../../data/models.dart';
import '../../ui/app_shell.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

import '../../l10n/app_localizations.dart';

/// Port of client/src/pages/admin-users.tsx (list view).
class AdminUsersScreen extends StatefulWidget {
  const AdminUsersScreen({super.key});

  @override
  State<AdminUsersScreen> createState() => _AdminUsersScreenState();
}

class _AdminUsersScreenState extends State<AdminUsersScreen> {
  List<UserRow> _items = [];
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
      final items = await context.read<DdsRepository>().users();
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
      title: 'User Management',
      actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      child: _loading
          ? loadingOr(null)
          : _error != null
          ? loadingOr(_error, onRetry: _load)
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: _items.length + 1,
                itemBuilder: (context, i) {
                  if (i == _items.length) {
                    return const SizedBox(height: 40);
                  }
                  final u = _items[i];
                  return Card(
                    margin: const EdgeInsets.only(bottom: 10),
                    child: ListTile(
                      leading: CircleAvatar(
                        backgroundColor: DdsColors.primary.withValues(
                          alpha: 0.12,
                        ),
                        child: Text(
                          u.fullName.isNotEmpty
                              ? u.fullName[0].toUpperCase()
                              : '?',
                          style: const TextStyle(
                            color: DdsColors.primary,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      title: Text(
                        u.fullName,
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 14,
                        ),
                      ),
                      subtitle: Text(
                        '${u.email}\n${u.facilityName ?? tr('No facility')}',
                        style: const TextStyle(fontSize: 11),
                      ),
                      isThreeLine: true,
                      trailing: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            tr(kRoleLabels[u.role] ?? u.role),
                            style: const TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          Text(
                            tr(u.status),
                            style: TextStyle(
                              fontSize: 10,
                              color: u.status == 'active'
                                  ? DdsColors.success
                                  : DdsColors.destructive,
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
    );
  }
}

/// Port of client/src/pages/admin-facilities.tsx (list view).
class AdminFacilitiesScreen extends StatefulWidget {
  const AdminFacilitiesScreen({super.key});

  @override
  State<AdminFacilitiesScreen> createState() => _AdminFacilitiesScreenState();
}

class _AdminFacilitiesScreenState extends State<AdminFacilitiesScreen> {
  List<Facility> _items = [];
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
      final items = await context.read<DdsRepository>().facilities();
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
      title: 'Facilities',
      actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      child: _loading
          ? loadingOr(null)
          : _error != null
          ? loadingOr(_error, onRetry: _load)
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: _items.length,
                itemBuilder: (context, i) {
                  final f = _items[i];
                  return Card(
                    margin: const EdgeInsets.only(bottom: 10),
                    child: ListTile(
                      leading: const Icon(
                        Icons.local_hospital_outlined,
                        color: DdsColors.primary,
                      ),
                      title: Text(
                        f.facilityName,
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 14,
                        ),
                      ),
                      subtitle: Text(
                        '${f.district}, ${f.province} · ${f.facilityType}',
                        style: const TextStyle(fontSize: 11),
                      ),
                    ),
                  );
                },
              ),
            ),
    );
  }
}

/// Port of client/src/pages/audit.tsx — hash-chained audit log + verify.
class AuditScreen extends StatefulWidget {
  const AuditScreen({super.key});

  @override
  State<AuditScreen> createState() => _AuditScreenState();
}

class _AuditScreenState extends State<AuditScreen> {
  List<AuditRow> _items = [];
  bool _loading = true;
  Object? _error;
  bool _verifying = false;
  String? _verifyResult;

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
      final items = await context.read<DdsRepository>().audit();
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

  Future<void> _verify() async {
    setState(() {
      _verifying = true;
      _verifyResult = null;
    });
    try {
      final res = await context.read<DdsRepository>().auditVerify();
      if (mounted) {
        setState(
          () => _verifyResult = res['ok'] == true || res['valid'] == true
              ? tr('Chain verified — no tampering detected.')
              : tr('Chain integrity check FAILED.'),
        );
      }
    } catch (e) {
      if (mounted) setState(() => _verifyResult = '$e');
    } finally {
      if (mounted) setState(() => _verifying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Audit Trail',
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
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          tr('{n} entries', {'n': _items.length}),
                          style: const TextStyle(
                            fontSize: 12,
                            color: DdsColors.mutedForeground,
                          ),
                        ),
                      ),
                      OutlinedButton.icon(
                        onPressed: _verifying ? null : _verify,
                        icon: _verifying
                            ? const SizedBox(
                                width: 12,
                                height: 12,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.verified_outlined, size: 16),
                        label: Text(tr('Verify chain')),
                      ),
                    ],
                  ),
                  if (_verifyResult != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8, bottom: 4),
                      child: Text(
                        _verifyResult!,
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  const SizedBox(height: 8),
                  for (final a in _items)
                    Card(
                      margin: const EdgeInsets.only(bottom: 8),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    a.action,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w600,
                                      fontSize: 13,
                                    ),
                                  ),
                                ),
                                Text(
                                  fmtDateTime(a.createdAt),
                                  style: const TextStyle(
                                    fontSize: 10,
                                    color: DdsColors.mutedForeground,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '${a.entityType}${a.entityId != null ? ' · ${a.entityId}' : ''} · ${a.userName ?? tr('system')}',
                              style: const TextStyle(
                                fontSize: 11,
                                color: DdsColors.mutedForeground,
                              ),
                            ),
                            Text(
                              'sha256: ${a.recordHash.length > 28 ? '${a.recordHash.substring(0, 28)}…' : a.recordHash}',
                              style: const TextStyle(
                                fontSize: 10,
                                fontFamily: 'monospace',
                                color: DdsColors.mutedForeground,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  const SizedBox(height: 40),
                ],
              ),
            ),
    );
  }
}
