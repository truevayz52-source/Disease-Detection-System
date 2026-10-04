import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../data/api_client.dart';
import '../data/auth_repository.dart';
import '../data/sync_service.dart';
import '../data/models.dart';
import '../l10n/app_localizations.dart';
import '../l10n/language_provider.dart';
import 'language_menu.dart';
import 'theme.dart';
import 'widgets.dart';

/// Shared sign-out confirmation — asks whether offline access (cached data +
/// offline sign-in) should be kept on this device. Returns after the session
/// is cleared; null dialog result cancels without signing out.
Future<void> confirmSignOut(BuildContext context) async {
  final wipe = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(context.tr('Sign out')),
      content: Text(
        context.tr(
          'Keep offline access on this device? Keeping it lets this account '
          'sign in and view last-synced data without a connection.',
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(c),
          child: Text(context.tr('Cancel')),
        ),
        TextButton(
          onPressed: () => Navigator.pop(c, true),
          child: Text(context.tr('Remove offline access')),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(c, false),
          child: Text(context.tr('Keep')),
        ),
      ],
    ),
  );
  if (wipe == null || !context.mounted) return;
  await context.read<AuthRepository>().signOut(wipeOffline: wipe);
}

/// Navigation item — port of NAV_ITEMS in client/src/components/app-sidebar.tsx.
/// [route] is null for entries not yet ported to mobile; they render a
/// "coming soon" placeholder so the menu matches the web app exactly.
class NavItem {
  final String path;
  final String label;
  final IconData icon;
  final List<String> roles;
  final bool implemented;

  const NavItem(
    this.path,
    this.label,
    this.icon,
    this.roles, {
    this.implemented = true,
  });
}

const kNavItems = <NavItem>[
  NavItem('/dashboard', 'Dashboard', Icons.dashboard_outlined, kRoles),
  NavItem('/notifications', 'Death Notifications', Icons.post_add_outlined, [
    'medical_officer',
    'public_health_analyst',
    'system_admin',
    'mortuary_clerk',
  ]),
  NavItem(
    '/pathology/queue',
    'Pathology Review Queue',
    Icons.biotech_outlined,
    ['pathologist'],
  ),
  NavItem('/autopsy', 'Autopsy Reports', Icons.medical_services_outlined, [
    'pathologist',
    'public_health_analyst',
    'system_admin',
  ]),
  NavItem('/voice-autopsy', 'Verbal Autopsy', Icons.mic_none_outlined, [
    'medical_officer',
    'mortuary_clerk',
    'system_admin',
  ], implemented: false),
  NavItem('/signals', 'Signal Registry', Icons.sensors_outlined, [
    'medical_officer',
    'mortuary_clerk',
    'public_health_analyst',
    'system_admin',
  ], implemented: false),
  NavItem('/mpdsr', 'MPDSR Workflows', Icons.fact_check_outlined, [
    'medical_officer',
    'public_health_analyst',
    'system_admin',
  ], implemented: false),
  NavItem('/alerts', 'Alerts', Icons.warning_amber_outlined, [
    'medical_officer',
    'pathologist',
    'public_health_analyst',
    'system_admin',
  ]),
  NavItem('/analytics', 'Outbreak Analytics', Icons.insights_outlined, [
    'public_health_analyst',
    'system_admin',
  ]),
  NavItem('/analytics/map', 'Outbreak Map', Icons.map_outlined, [
    'public_health_analyst',
    'system_admin',
  ], implemented: false),
  NavItem(
    '/cross-border',
    'Cross-border Tracking',
    Icons.compare_arrows_outlined,
    ['medical_officer', 'public_health_analyst', 'system_admin'],
    implemented: false,
  ),
  NavItem(
    '/resource-allocation',
    'Resource Forecasting',
    Icons.query_stats_outlined,
    ['public_health_analyst', 'system_admin'],
    implemented: false,
  ),
  NavItem('/reports', 'Reports', Icons.description_outlined, [
    'public_health_analyst',
    'system_admin',
    'executive',
  ], implemented: false),
  NavItem('/gps-dashboard', 'GPS Tracking', Icons.gps_fixed_outlined, [
    'medical_officer',
    'system_admin',
  ], implemented: false),
  NavItem('/offline-sync', 'Offline Sync', Icons.sync_outlined, [
    'medical_officer',
    'mortuary_clerk',
    'system_admin',
  ]),
  NavItem('/admin/users', 'User Management', Icons.group_outlined, [
    'system_admin',
  ]),
  NavItem('/admin/facilities', 'Facilities', Icons.local_hospital_outlined, [
    'system_admin',
  ]),
  NavItem('/alert-config', 'Alert Thresholds', Icons.tune_outlined, [
    'public_health_analyst',
    'system_admin',
  ], implemented: false),
  NavItem('/security-dashboard', 'Security Dashboard', Icons.shield_outlined, [
    'system_admin',
  ], implemented: false),
  NavItem('/audit', 'Audit Trail', Icons.receipt_long_outlined, [
    'public_health_analyst',
    'system_admin',
  ]),
  NavItem('/system-settings', 'System Settings', Icons.settings_outlined, [
    'system_admin',
  ], implemented: false),
];

List<NavItem> navItemsFor(String role) =>
    kNavItems.where((i) => i.roles.contains(role)).toList();

/// Scaffold used by every authenticated screen — AppBar + role-aware drawer,
/// mirroring the web AppLayout/SiteHeader + sidebar combination.
class AppScaffold extends StatelessWidget {
  const AppScaffold({
    super.key,
    required this.title,
    required this.child,
    this.actions,
    this.floatingActionButton,
  });

  final String title;
  final Widget child;
  final List<Widget>? actions;
  final Widget? floatingActionButton;

  @override
  Widget build(BuildContext context) {
    final sync = context.watch<SyncService>();
    final lang = context.watch<LanguageProvider>();
    return Scaffold(
      appBar: AppBar(
        title: Text(context.tr(title)),
        actions: [
          ...?actions,
          const LanguageMenuButton(),
          if (sync.pendingCount > 0)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: IconButton(
                tooltip: context.tr('{n} offline item(s) pending sync', {
                  'n': sync.pendingCount,
                }),
                onPressed: () => context.push('/offline-sync'),
                icon: Badge(
                  label: Text('${sync.pendingCount}'),
                  child: const Icon(Icons.cloud_upload_outlined),
                ),
              ),
            ),
        ],
      ),
      drawer: const AppDrawer(),
      floatingActionButton: floatingActionButton,
      body: SafeArea(
        child: Column(
          children: [
            if (lang.isSignLanguage)
              Container(
                width: double.infinity,
                color: const Color(0xFFE0F2FE),
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 6,
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.accessibility_new,
                      size: 14,
                      color: Color(0xFF075985),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        context.tr(
                          'Zimbabwe Sign Language selected — text is shown in English; signed video guidance is a planned module.',
                        ),
                        style: const TextStyle(
                          fontSize: 12,
                          color: Color(0xFF075985),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            if (!sync.isOnline)
              Container(
                width: double.infinity,
                color: const Color(0xFFFEF3C7),
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 6,
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.wifi_off,
                      size: 14,
                      color: Color(0xFF92400E),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Builder(
                        builder: (context) {
                          final asOf = context
                              .read<ApiClient>()
                              .lastLiveFetchAt;
                          final staleness = asOf != null
                              ? ' ${context.tr('(as of {ts})', {'ts': fmtDateTime(asOf.toIso8601String())})}'
                              : '';
                          final pending = sync.pendingCount > 0
                              ? ' ${context.tr('{n} change(s) will sync on reconnect.', {'n': sync.pendingCount})}'
                              : '';
                          return Text(
                            context.tr('Offline — showing cached data') +
                                staleness +
                                pending,
                            style: const TextStyle(
                              fontSize: 12,
                              color: Color(0xFF92400E),
                            ),
                          );
                        },
                      ),
                    ),
                  ],
                ),
              ),
            Expanded(child: child),
          ],
        ),
      ),
    );
  }
}

class AppDrawer extends StatelessWidget {
  const AppDrawer({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthRepository>();
    final user = auth.user;
    final location = GoRouterState.of(context).uri.path;
    final items = user == null ? <NavItem>[] : navItemsFor(user.role);

    return Drawer(
      backgroundColor: DdsColors.sidebar,
      child: SafeArea(
        child: Column(
          children: [
            // Brand header — mirrors SidebarHeader
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                border: Border(
                  bottom: BorderSide(
                    color: Colors.white.withValues(alpha: 0.1),
                  ),
                ),
              ),
              child: Row(
                children: [
                  Container(
                    width: 42,
                    height: 42,
                    padding: const EdgeInsets.all(5),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Image.asset(
                      'assets/mohcc-logo.png',
                      fit: BoxFit.contain,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          tr('Disease Detection System'),
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        Text(
                          tr('MOHCC Zimbabwe'),
                          style: TextStyle(
                            color: DdsColors.emerald,
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 6),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  context.tr('Workspace').toUpperCase(),
                  style: const TextStyle(
                    color: Colors.white54,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 1.1,
                  ),
                ),
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                children: [
                  for (final item in items)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 2),
                      child: ListTile(
                        dense: true,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8),
                        ),
                        leading: Icon(
                          item.icon,
                          size: 19,
                          color: location.startsWith(item.path)
                              ? Colors.white
                              : Colors.white70,
                        ),
                        title: Text(
                          context.tr(item.label),
                          style: TextStyle(
                            fontSize: 13,
                            color: location.startsWith(item.path)
                                ? Colors.white
                                : Colors.white70,
                            fontWeight: location.startsWith(item.path)
                                ? FontWeight.w700
                                : FontWeight.w500,
                          ),
                        ),
                        tileColor: location.startsWith(item.path)
                            ? DdsColors.sidebarPrimary
                            : null,
                        onTap: () {
                          Navigator.of(context).pop();
                          context.go(item.path);
                        },
                      ),
                    ),
                ],
              ),
            ),
            // User footer — mirrors NavUser
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                border: Border(
                  top: BorderSide(color: Colors.white.withValues(alpha: 0.1)),
                ),
              ),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 17,
                    backgroundColor: DdsColors.sidebarPrimary,
                    child: Text(
                      (user?.name.isNotEmpty == true ? user!.name[0] : '?')
                          .toUpperCase(),
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          user?.name ?? '',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        Text(
                          context.tr(
                            kRoleLabels[user?.role] ?? user?.role ?? '',
                          ),
                          style: const TextStyle(
                            color: Colors.white54,
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: context.tr('Profile'),
                    icon: const Icon(
                      Icons.person_outline,
                      color: Colors.white70,
                      size: 20,
                    ),
                    onPressed: () {
                      Navigator.of(context).pop();
                      context.go('/profile');
                    },
                  ),
                  IconButton(
                    tooltip: context.tr('Sign out'),
                    icon: const Icon(
                      Icons.logout,
                      color: Colors.white70,
                      size: 20,
                    ),
                    onPressed: () => confirmSignOut(context),
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
