import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../data/api_client.dart';
import '../../data/dds_repository.dart';
import '../../data/sync_service.dart';
import '../../ui/app_shell.dart';
import '../../ui/server_settings.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

import '../../l10n/app_localizations.dart';

/// Mobile system settings — the admin home for connection, offline data,
/// the site notice and integration status. Replaces the placeholder at
/// /system-settings (web port: client/src/pages/operations.tsx SettingsPage).
class SystemSettingsScreen extends StatefulWidget {
  const SystemSettingsScreen({super.key});

  @override
  State<SystemSettingsScreen> createState() => _SystemSettingsScreenState();
}

class _SystemSettingsScreenState extends State<SystemSettingsScreen> {
  /// Display names for /integrations/status service keys — literals inside
  /// tr() so the i18n scanner picks them up.
  String _serviceLabel(String key) => switch (key) {
    'analytics' => tr('Analytics engine'),
    'pathologyModel' => tr('Pathology model'),
    'whisper' => tr('Transcription (Whisper)'),
    'whoCatalog' => tr('WHO ICD-11 catalog'),
    'regionalBridge' => tr('Regional bridge'),
    'email' => tr('Email (SMTP)'),
    'translation' => tr('AI translation (Gemini)'),
    'audit' => tr('Audit chain'),
    _ => key,
  };

  final _notice = TextEditingController();
  List<Map<String, dynamic>> _settings = const [];
  Map<String, dynamic> _integrations = const {};
  bool _loading = true;
  Object? _error;
  bool _saving = false;
  bool _pushing = false;

  Future<void> _pushRegional() async {
    setState(() => _pushing = true);
    try {
      final res = await context.read<DdsRepository>().regionalPush(days: 30);
      if (!mounted) return;
      final targets = (res['targets'] as List?) ?? [];
      final ok = targets.where((t) => (t as Map)['ok'] == true).length;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            tr('Regional push complete — {ok}/{n} target(s) accepted', {
              'ok': ok,
              'n': targets.length,
            }),
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _pushing = false);
    }
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _notice.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final repo = context.read<DdsRepository>();
      final settings = await repo.systemSettings();
      Map<String, dynamic> integrations = const {};
      try {
        integrations = await repo.integrationsStatus();
      } catch (_) {
        /* offline — leave empty, cached value would be stale anyway */
      }
      String notice = '';
      for (final s in settings) {
        if (s['setting_key'] == 'site_notice') {
          notice = _decode(s['setting_value']);
        }
      }
      if (!mounted) return;
      setState(() {
        _settings = settings;
        _integrations = integrations;
        _notice.text = notice;
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

  /// setting_value arrives JSON-encoded ("\"text\"") — unwrap when possible.
  String _decode(dynamic raw) {
    final s = raw?.toString() ?? '';
    try {
      final v = jsonDecode(s);
      return v?.toString() ?? s;
    } catch (_) {
      return s;
    }
  }

  Future<void> _saveNotice() async {
    setState(() => _saving = true);
    try {
      await context.read<DdsRepository>().saveSetting(
        'site_notice',
        _notice.text,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(tr('Setting saved'))));
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  /// Purge the offline read cache (GET response cache + timestamps).
  /// Queued mutations and credentials are untouched.
  Future<void> _clearCache() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(tr('Clear cached data?')),
        content: Text(
          tr(
            'Cached pages are removed and re-downloaded on next use. Queued submissions and sign-in data are kept.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c),
            child: Text(tr('Cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(c, true),
            child: Text(tr('Clear')),
          ),
        ],
      ),
    );
    if (ok != true) return;
    final prefs = await SharedPreferences.getInstance();
    for (final key in prefs.getKeys().toList()) {
      if (key.startsWith('cache:') ||
          key.startsWith('cache_ts:') ||
          key == 'dds_last_live_get') {
        await prefs.remove(key);
      }
    }
    if (mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(tr('Cached data cleared'))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final api = context.read<ApiClient>();
    final sync = context.watch<SyncService>();
    return AppScaffold(
      title: tr('System Settings'),
      actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      child: _loading
          ? loadingOr(null)
          : _error != null
          ? loadingOr(_error, onRetry: _load)
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // ── Connection (device-local, admin-only entry point) ──
                SectionCard(
                  title: tr('Connection'),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          Container(
                            width: 12,
                            height: 12,
                            decoration: BoxDecoration(
                              color: sync.isOnline
                                  ? DdsColors.success
                                  : DdsColors.destructive,
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  sync.isOnline ? tr('Online') : tr('Offline'),
                                  style: const TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                Text(
                                  api.baseUrl,
                                  style: const TextStyle(
                                    fontSize: 11,
                                    color: DdsColors.mutedForeground,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                          TextButton(
                            onPressed: () async {
                              await ServerSettingsSheet.show(context);
                              if (mounted) setState(() {});
                            },
                            child: Text(tr('Configure')),
                          ),
                        ],
                      ),
                      if (api.lastLiveFetchAt != null) ...[
                        const Divider(height: 20),
                        InfoRow(
                          tr('Last live data'),
                          fmtDateTime(api.lastLiveFetchAt!.toIso8601String()),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 12),

                // ── Offline data ──
                SectionCard(
                  title: tr('Offline data'),
                  child: Column(
                    children: [
                      InfoRow(
                        tr('Pending submissions'),
                        tr('{n} item(s)', {'n': sync.pendingCount}),
                      ),
                      InfoRow(
                        tr('Last sync'),
                        sync.lastSyncAt != null
                            ? fmtDateTime(sync.lastSyncAt!.toIso8601String())
                            : '—',
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () => context.push('/offline-sync'),
                              icon: const Icon(Icons.sync, size: 16),
                              label: Text(tr('Open sync queue')),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: _clearCache,
                              icon: const Icon(
                                Icons.delete_sweep_outlined,
                                size: 16,
                              ),
                              label: Text(tr('Clear cached data')),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),

                // ── Site notice (server-backed) ──
                SectionCard(
                  title: tr('Site notice'),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      TextField(
                        controller: _notice,
                        maxLines: 3,
                        minLines: 1,
                        decoration: InputDecoration(
                          labelText: tr('Notice shown to all users'),
                          border: const OutlineInputBorder(),
                          isDense: true,
                        ),
                      ),
                      const SizedBox(height: 10),
                      Align(
                        alignment: Alignment.centerRight,
                        child: FilledButton(
                          onPressed: _saving ? null : _saveNotice,
                          child: _saving
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Colors.white,
                                  ),
                                )
                              : Text(tr('Save notice')),
                        ),
                      ),
                    ],
                  ),
                ),

                // ── All system settings (read-only view) ──
                if (_settings.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  SectionCard(
                    title: tr('All settings'),
                    child: Column(
                      children: [
                        for (final s in _settings)
                          InfoRow(
                            s['setting_key']?.toString() ?? '',
                            _decode(s['setting_value']),
                          ),
                      ],
                    ),
                  ),
                ],

                // ── Connected services ──
                if (_integrations.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  SectionCard(
                    title: tr('Connected services'),
                    child: Column(
                      children: [
                        for (final e in _integrations.entries)
                          InfoRow(
                            _serviceLabel(e.key),
                            e.value == true
                                ? tr('Available')
                                : (e.value?.toString() ?? '—'),
                          ),
                        const SizedBox(height: 4),
                        SizedBox(
                          width: double.infinity,
                          child: OutlinedButton.icon(
                            onPressed: _pushing ? null : _pushRegional,
                            icon: const Icon(Icons.upload_outlined, size: 16),
                            label: Text(
                              _pushing
                                  ? tr('Pushing…')
                                  : tr(
                                      'Push 30-day aggregate to regional HMIS',
                                    ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],

                const SizedBox(height: 12),
                SectionCard(
                  title: tr('About'),
                  child: Column(
                    children: [
                      InfoRow(tr('App version'), '1.0.0'),
                      InfoRow(tr('Package'), 'zw.org.mohcc.dds_mobile'),
                    ],
                  ),
                ),
                const SizedBox(height: 24),
              ],
            ),
    );
  }
}
