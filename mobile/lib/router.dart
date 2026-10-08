import 'package:go_router/go_router.dart';

import 'data/auth_repository.dart';
import 'features/admin/admin_screens.dart';
import 'features/admin/system_settings_screen.dart';
import 'features/alerts/alerts_screen.dart';
import 'features/analytics/analytics_screen.dart';
import 'features/auth/sign_in_screen.dart';
import 'features/autopsies/autopsies_screen.dart';
import 'features/dashboard/dashboard_screen.dart';
import 'features/misc/misc_screens.dart';
import 'features/misc/offline_sync_screen.dart';
import 'features/notifications/notification_detail_screen.dart';
import 'features/notifications/notification_new_screen.dart';
import 'features/notifications/notifications_screen.dart';
import 'features/pathology/pathology_screens.dart';
import 'ui/app_shell.dart';

/// Routes the executive role lands on — mirrors App.tsx's dashboard split.
const _analystRoles = ['public_health_analyst', 'system_admin'];
const _clinicalRoles = ['medical_officer', 'pathologist', 'system_admin'];

/// Role gates mirroring RequireRole in client/src/App.tsx.
final _routeRoles = <String, List<String>>{
  '/dashboard': const [
    'medical_officer',
    'pathologist',
    'public_health_analyst',
    'system_admin',
    'mortuary_clerk',
    'executive',
  ],
  '/notifications': const [
    'medical_officer',
    'mortuary_clerk',
    'public_health_analyst',
    'system_admin',
  ],
  '/notifications/new': const [
    'medical_officer',
    'mortuary_clerk',
    'public_health_analyst',
    'system_admin',
  ],
  '/pathology/queue': const ['pathologist', 'system_admin'],
  '/autopsy': _clinicalRoles,
  '/alerts': const [
    'medical_officer',
    'pathologist',
    'public_health_analyst',
    'system_admin',
  ],
  '/analytics': _analystRoles,
  '/admin/users': const ['system_admin'],
  '/admin/facilities': const ['system_admin'],
  '/system-settings': const ['system_admin'],
  '/audit': _analystRoles,
};

GoRouter buildRouter(AuthRepository auth) {
  return GoRouter(
    initialLocation: '/dashboard',
    refreshListenable: auth,
    redirect: (context, state) {
      if (auth.loading) {
        return state.uri.path == '/splash' ? null : '/splash';
      }
      final signedIn = auth.signedIn;
      final path = state.uri.path;
      final onAuthPage = path == '/sign-in' || path == '/forgot-password';

      if (!signedIn) return onAuthPage ? null : '/sign-in';
      // Signed in — never linger on the splash screen.
      if (path == '/splash' || path == '/sign-in' || path == '/') {
        return '/dashboard';
      }

      // Role gating — mirrors RequireRole in App.tsx. Detail routes use
      // their own gates; /notifications/:id is open to any signed-in user
      // on the web (the API enforces record-level access), same here.
      final List<String>? allowed;
      if (_routeRoles.containsKey(path)) {
        allowed = _routeRoles[path];
      } else if (RegExp(r'^/notifications/[^/]+$').hasMatch(path)) {
        allowed = null;
      } else if (RegExp(r'^/pathology/review/[^/]+$').hasMatch(path)) {
        allowed = const ['pathologist', 'system_admin'];
      } else if (RegExp(r'^/autopsy/[^/]+$').hasMatch(path)) {
        allowed = _clinicalRoles;
      } else {
        allowed = kNavItems
            .where((i) => i.path == path)
            .map((i) => i.roles)
            .firstOrNull;
      }
      if (allowed != null && !allowed.contains(auth.user!.role)) {
        return '/forbidden';
      }
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (c, s) => const SplashScreen()),
      GoRoute(path: '/sign-in', builder: (c, s) => const SignInScreen()),
      GoRoute(
        path: '/forgot-password',
        builder: (c, s) => const ForgotPasswordScreen(),
      ),
      GoRoute(path: '/forbidden', builder: (c, s) => const ForbiddenScreen()),
      GoRoute(path: '/dashboard', builder: (c, s) => const DashboardScreen()),
      GoRoute(path: '/profile', builder: (c, s) => const ProfileScreen()),
      GoRoute(
        path: '/notifications',
        builder: (c, s) => const NotificationsScreen(),
      ),
      GoRoute(
        path: '/notifications/new',
        builder: (c, s) => const NotificationNewScreen(),
      ),
      GoRoute(
        path: '/notifications/:id',
        builder: (c, s) =>
            NotificationDetailScreen(id: s.pathParameters['id']!),
      ),
      GoRoute(
        path: '/pathology/queue',
        builder: (c, s) => const PathologyQueueScreen(),
      ),
      GoRoute(
        path: '/pathology/review/:id',
        builder: (c, s) => PathologyReviewScreen(id: s.pathParameters['id']!),
      ),
      GoRoute(path: '/autopsy', builder: (c, s) => const AutopsiesScreen()),
      GoRoute(
        path: '/autopsy/:id',
        builder: (c, s) => AutopsyDetailScreen(id: s.pathParameters['id']!),
      ),
      GoRoute(path: '/alerts', builder: (c, s) => const AlertsScreen()),
      GoRoute(path: '/analytics', builder: (c, s) => const AnalyticsScreen()),
      GoRoute(
        path: '/admin/users',
        builder: (c, s) => const AdminUsersScreen(),
      ),
      GoRoute(
        path: '/admin/facilities',
        builder: (c, s) => const AdminFacilitiesScreen(),
      ),
      GoRoute(path: '/audit', builder: (c, s) => const AuditScreen()),
      GoRoute(
        path: '/system-settings',
        builder: (c, s) => const SystemSettingsScreen(),
      ),
      GoRoute(
        path: '/offline-sync',
        builder: (c, s) => const OfflineSyncScreen(),
      ),
      // Nav parity: modules not yet ported render a placeholder.
      for (final item in kNavItems.where((i) => !i.implemented))
        GoRoute(
          path: item.path,
          builder: (c, s) => ComingSoonScreen(title: item.label),
        ),
    ],
    errorBuilder: (context, state) => const ForbiddenScreen(),
  );
}
