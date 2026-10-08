import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../data/api_client.dart';
import '../../data/auth_repository.dart';
import '../../data/biometric_auth.dart';
import '../../data/offline_accounts.dart';
import '../../data/models.dart';
import '../../ui/app_shell.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

import '../../l10n/app_localizations.dart';
import '../../l10n/language_provider.dart';

/// Profile / sign-out — port of the web user-profile essentials.
class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final user = context.watch<AuthRepository>().user;
    return AppScaffold(
      title: tr('Profile'),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  CircleAvatar(
                    radius: 34,
                    backgroundColor: DdsColors.primary,
                    child: Text(
                      (user?.name.isNotEmpty == true ? user!.name[0] : '?')
                          .toUpperCase(),
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 26,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    user?.name ?? '',
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  Text(
                    user?.email ?? '',
                    style: const TextStyle(
                      fontSize: 12,
                      color: DdsColors.mutedForeground,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFFDCFCE7),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      tr(kRoleLabels[user?.role] ?? ''),
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: DdsColors.primary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          SectionCard(
            title: tr('Account details'),
            child: Column(
              children: [
                InfoRow(tr('Role'), tr(kRoleLabels[user?.role] ?? '—')),
                InfoRow(
                  tr('Facility'),
                  user?.facilityId ?? tr('National scope'),
                ),
                InfoRow(tr('Province'), user?.province ?? '—'),
                InfoRow(tr('District'), user?.district ?? '—'),
                InfoRow(tr('Phone'), user?.phone ?? '—'),
                InfoRow(tr('Department'), user?.department ?? '—'),
                // Language selector — all 16 official languages, instant
                // switch + profile sync (LanguageProvider handles both).
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 110,
                        child: Text(
                          tr('Language'),
                          style: const TextStyle(
                            fontSize: 12,
                            color: DdsColors.mutedForeground,
                          ),
                        ),
                      ),
                      Expanded(
                        child: DropdownButton<String>(
                          isExpanded: true,
                          value: context.watch<LanguageProvider>().code,
                          underline: const SizedBox.shrink(),
                          items: [
                            for (final l in kLanguages)
                              DropdownMenuItem(
                                value: l.code,
                                child: Text(l.nativeName),
                              ),
                          ],
                          onChanged: (code) {
                            if (code == null) return;
                            context.read<LanguageProvider>().setLanguage(
                              code,
                              api: context.read<ApiClient>(),
                            );
                          },
                        ),
                      ),
                    ],
                  ),
                ),
                InfoRow(tr('Timezone'), user?.timezone ?? '—'),
                InfoRow(tr('Last login'), fmtDateTime(user?.lastLoginAt)),
              ],
            ),
          ),
          const SizedBox(height: 16),
          SecurityCard(email: user?.email ?? ''),
          const SizedBox(height: 16),
          FilledButton.icon(
            style: FilledButton.styleFrom(
              backgroundColor: DdsColors.destructive,
            ),
            onPressed: () => confirmSignOut(context),
            icon: const Icon(Icons.logout, size: 16),
            label: Text(tr('Sign out')),
          ),
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

/// Port of client/src/pages/password-reset.tsx (request reset link flow).
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _email = TextEditingController();
  bool _loading = false;
  String? _message;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _loading = true;
      _message = null;
    });
    try {
      final res = await context.read<ApiClient>().post(
        '/user/request-password-reset',
        body: {'email': _email.text.trim()},
      );
      setState(
        () => _message = res['message']?.toString() ?? tr('Reset link sent.'),
      );
    } on ApiException catch (e) {
      setState(() => _message = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(tr('Forgot password'))),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      tr('Disease Detection System'),
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: DdsColors.primary,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      tr('Forgot password'),
                      style: TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: _email,
                      keyboardType: TextInputType.emailAddress,
                      decoration: InputDecoration(
                        labelText: tr('Email address'),
                      ),
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: _loading ? null : _submit,
                      child: _loading
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : Text(tr('Request reset link')),
                    ),
                    if (_message != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Text(
                          _message!,
                          style: const TextStyle(fontSize: 13),
                        ),
                      ),
                    TextButton(
                      onPressed: () => context.go('/sign-in'),
                      child: Text(
                        tr('Return to sign in'),
                        style: TextStyle(decoration: TextDecoration.underline),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Shown while the stored session is being restored (mirrors the web
/// app's "Loading…" guard in RequireAuth).
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text(
              tr('Loading…'),
              style: TextStyle(fontSize: 13, color: DdsColors.mutedForeground),
            ),
          ],
        ),
      ),
    );
  }
}

/// Port of client/src/pages/forbidden.tsx
class ForbiddenScreen extends StatelessWidget {
  const ForbiddenScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  color: DdsColors.destructive.withValues(alpha: 0.1),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.block,
                  color: DdsColors.destructive,
                  size: 28,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                tr('Access restricted'),
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 6),
              Text(
                tr(
                  'Your role does not have permission to view this section of the Disease Detection System. Contact your System Administrator if you believe this is an error.',
                ),
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 13,
                  color: DdsColors.mutedForeground,
                ),
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => context.go('/dashboard'),
                child: Text(tr('Back to dashboard')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Placeholder for sidebar destinations not yet ported to mobile.
class ComingSoonScreen extends StatelessWidget {
  const ComingSoonScreen({super.key, required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: title,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.phone_android_outlined,
                size: 40,
                color: DdsColors.mutedForeground,
              ),
              const SizedBox(height: 12),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                tr(
                  tr(
                    'This module is available in the web application and is being ported to mobile.',
                  ),
                ),
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 13,
                  color: DdsColors.mutedForeground,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Security settings — biometric unlock toggle + device-settings deep link
/// (when the phone has no enrolled fingerprint/face), plus the runtime
/// server address so staff can retarget the API without a rebuild.
class SecurityCard extends StatefulWidget {
  const SecurityCard({super.key, required this.email});

  final String email;

  @override
  State<SecurityCard> createState() => _SecurityCardState();
}

class _SecurityCardState extends State<SecurityCard> {
  BiometricStatus? _status;
  bool _enabled = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final status = await BiometricAuth.status;
    final acct = widget.email.isEmpty
        ? null
        : await OfflineAccountStore().getAccount(widget.email);
    if (!mounted) return;
    setState(() {
      _status = status;
      _enabled = acct?.biometricEnabled == true;
    });
  }

  Future<void> _toggle(bool want) async {
    if (widget.email.isEmpty) return;
    if (want) {
      final ok = await BiometricAuth.enroll(widget.email);
      if (!mounted) return;
      setState(() => _enabled = ok);
      if (!ok) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(tr('Biometric setup was cancelled.'))),
        );
      }
    } else {
      await BiometricAuth.disable(widget.email);
      if (mounted) setState(() => _enabled = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      title: tr('Security'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.fingerprint, size: 20, color: DdsColors.primary),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      tr('Biometric sign-in'),
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      switch (_status) {
                        null => tr('Checking device…'),
                        BiometricStatus.unavailable => tr(
                          'Not supported on this device',
                        ),
                        BiometricStatus.notEnrolled => tr(
                          'No fingerprint or face enrolled on this device',
                        ),
                        BiometricStatus.ready =>
                          _enabled
                              ? tr('Enabled for this account')
                              : tr('Available — turn on to enable'),
                      },
                      style: const TextStyle(
                        fontSize: 11,
                        color: DdsColors.mutedForeground,
                      ),
                    ),
                  ],
                ),
              ),
              if (_status == BiometricStatus.notEnrolled)
                TextButton(
                  onPressed: () => BiometricAuth.openSecuritySettings(),
                  child: Text(tr('Open settings')),
                )
              else if (_status == BiometricStatus.ready)
                Switch(value: _enabled, onChanged: _toggle),
            ],
          ),
        ],
      ),
    );
  }
}
