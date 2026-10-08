import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../data/api_client.dart';
import '../../data/auth_repository.dart';
import '../../data/biometric_auth.dart';
import '../../data/server_resolver.dart';

import '../../ui/theme.dart';
import '../../ui/language_menu.dart';

import '../../l10n/app_localizations.dart';

/// Port of client/src/pages/sign-in.tsx — split hero + form on wide screens
/// (like lg:grid-cols-2), single branded card on phones.
class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key});

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  bool _needsCode = false;
  bool _showPassword = false;
  bool _biometricAvailable = false;
  String? _error;
  bool _loading = false;

  /// null = still probing; true/false = server reachability for the chip.
  bool? _serverUp;

  @override
  void initState() {
    super.initState();
    _email.addListener(_checkBiometric);
    _restoreLastEmail();
    _probeServer();
  }

  /// Prefill the last signed-in account so offline/biometric users don't
  /// retype their address.
  Future<void> _restoreLastEmail() async {
    final last = (await SharedPreferences.getInstance()).getString(
      'dds_last_email',
    );
    if (last != null && mounted && _email.text.isEmpty) {
      _email.text = last;
    }
  }

  /// Live probe against the resolved base URL — shown as a chip so users
  /// can tell "wrong server" apart from "wrong password".
  Future<void> _probeServer() async {
    final api = context.read<ApiClient>();
    final up = await ServerResolver.probe(
      api.baseUrl,
      timeout: const Duration(seconds: 4),
    );
    if (mounted && up != _serverUp) setState(() => _serverUp = up);
  }

  @override
  void dispose() {
    _email.removeListener(_checkBiometric);
    _email.dispose();
    _password.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _checkBiometric() async {
    final email = _email.text.trim();
    if (email.isEmpty) {
      if (_biometricAvailable) setState(() => _biometricAvailable = false);
      return;
    }
    final enabled = await BiometricAuth.isEnabled(email);
    if (mounted && enabled != _biometricAvailable) {
      setState(() => _biometricAvailable = enabled);
    }
  }

  Future<void> _submit() async {
    if (_email.text.trim().isEmpty || _password.text.isEmpty) return;
    setState(() {
      _error = null;
      _loading = true;
    });
    final auth = context.read<AuthRepository>();
    final api = context.read<ApiClient>();
    try {
      await auth.signIn(
        _email.text.trim(),
        _password.text,
        code: _needsCode ? _code.text.trim() : null,
      );
      if (auth.offlineSession && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(tr('Signed in — offline mode.'))),
        );
      }
      // router redirect takes over once the user is set
    } on ApiException catch (e) {
      if (e.requiresTwoFactor) _needsCode = true;
      var message = e.message;
      if (e.status == 0) {
        // Server unreachable or offline account missing — tell the user the
        // address being tried so they can fix it via the gear sheet.
        message = '$message\n${tr('Server: {url}', {'url': api.baseUrl})}';
        unawaited(_probeServer());
      }
      setState(() {
        _error = message;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = tr('Sign-in failed');
        _loading = false;
      });
    }
  }

  Future<void> _submitBiometric() async {
    final email = _email.text.trim();
    if (email.isEmpty) return;
    setState(() {
      _error = null;
      _loading = true;
    });
    try {
      final auth = context.read<AuthRepository>();
      await auth.signInWithBiometric(email);
      if (auth.offlineSession && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(tr('Signed in — offline mode.'))),
        );
      }
    } on ApiException catch (e) {
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = tr('Biometric sign-in failed');
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Stack(
        children: [
          LayoutBuilder(
            builder: (context, constraints) {
              final wide = constraints.maxWidth >= 1024;
              return Row(
                children: [
                  if (wide) const Expanded(child: _HeroPanel()),
                  Expanded(child: _buildForm(context)),
                ],
              );
            },
          ),
          Positioned(
            top: 0,
            right: 0,
            child: SafeArea(
              child: Row(
                children: [
                  Padding(
                    padding: const EdgeInsets.only(right: 4),
                    child: _StatusDot(up: _serverUp),
                  ),
                  const LanguageMenuButton(),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildForm(BuildContext context) {
    final shortScreen = MediaQuery.of(context).size.height < 700;
    return SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Mobile top branding badge (hidden on wide split view)
                LayoutBuilder(
                  builder: (context, c) {
                    if (MediaQuery.of(context).size.width >= 1024) {
                      return const SizedBox.shrink();
                    }
                    return Padding(
                      padding: EdgeInsets.only(bottom: 10),
                      child: Text(
                        tr('MINISTRY OF HEALTH AND CHILD CARE · ZIMBABWE'),
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.8,
                          color: DdsColors.primary,
                        ),
                      ),
                    );
                  },
                ),
                Container(
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(
                      color: const Color(0xFFCBD5E1),
                      width: 2,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.12),
                        blurRadius: 24,
                        offset: const Offset(0, 8),
                      ),
                    ],
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(24, 20, 24, 0),
                        child: Column(
                          children: [
                            Image.asset(
                              'assets/zimbabwe-coat-of-arms.png',
                              height: shortScreen ? 44 : 64,
                              fit: BoxFit.contain,
                            ),
                            const SizedBox(height: 10),
                            Text(
                              tr('Sign in to DDS'),
                              style: TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.bold,
                                color: Colors.black,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              tr('Disease Detection System'),
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w500,
                                color: Colors.black87,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Padding(
                        padding: EdgeInsets.fromLTRB(
                          24,
                          14,
                          24,
                          shortScreen ? 14 : 24,
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            if (_error != null)
                              Container(
                                margin: const EdgeInsets.only(bottom: 12),
                                padding: const EdgeInsets.all(10),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFFEE2E2),
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(
                                    color: const Color(0xFFFCA5A5),
                                  ),
                                ),
                                child: Text(
                                  _error!,
                                  style: const TextStyle(
                                    fontSize: 13,
                                    color: Color(0xFFB91C1C),
                                  ),
                                ),
                              ),
                            _label(tr('Email Address')),
                            TextField(
                              controller: _email,
                              keyboardType: TextInputType.emailAddress,
                              autocorrect: false,
                              decoration: InputDecoration(
                                hintText: tr('name@mohcc.org.zw'),
                              ),
                              onSubmitted: (_) => _submit(),
                            ),
                            const SizedBox(height: 14),
                            _label(tr('Password')),
                            TextField(
                              controller: _password,
                              obscureText: !_showPassword,
                              decoration: InputDecoration(
                                hintText: tr('Enter your password'),
                                suffixIcon: IconButton(
                                  icon: Icon(
                                    _showPassword
                                        ? Icons.visibility_off
                                        : Icons.visibility,
                                    size: 18,
                                    color: Colors.black87,
                                  ),
                                  onPressed: () => setState(
                                    () => _showPassword = !_showPassword,
                                  ),
                                ),
                              ),
                              onSubmitted: (_) => _submit(),
                            ),
                            if (_needsCode) ...[
                              const SizedBox(height: 14),
                              _label(tr('Authenticator or recovery code')),
                              TextField(
                                controller: _code,
                                decoration: InputDecoration(
                                  hintText: tr(
                                    'Enter the code sent to your email',
                                  ),
                                ),
                                onSubmitted: (_) => _submit(),
                              ),
                            ],
                            const SizedBox(height: 18),
                            SizedBox(
                              height: 44,
                              child: FilledButton(
                                style: FilledButton.styleFrom(
                                  backgroundColor: DdsColors.linkBlue,
                                ),
                                onPressed: _loading ? null : _submit,
                                child: _loading
                                    ? const SizedBox(
                                        width: 18,
                                        height: 18,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                          color: Colors.white,
                                        ),
                                      )
                                    : Text(
                                        tr('Sign in'),
                                        style: TextStyle(
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                              ),
                            ),
                            if (_biometricAvailable) ...[
                              const SizedBox(height: 10),
                              SizedBox(
                                height: 44,
                                child: OutlinedButton.icon(
                                  onPressed: _loading ? null : _submitBiometric,
                                  icon: const Icon(Icons.fingerprint),
                                  label: Text(tr('Sign in with biometrics')),
                                  style: OutlinedButton.styleFrom(
                                    foregroundColor: DdsColors.linkBlue,
                                    side: const BorderSide(
                                      color: DdsColors.linkBlue,
                                    ),
                                  ),
                                ),
                              ),
                            ],
                            TextButton(
                              onPressed: () => context.push('/forgot-password'),
                              child: Text(
                                tr('Forgot password?'),
                                style: TextStyle(
                                  color: DdsColors.linkBlue,
                                  decoration: TextDecoration.underline,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        decoration: const BoxDecoration(
                          color: Color(0xFFF8FAFC),
                          border: Border(
                            top: BorderSide(color: Color(0xFFE2E8F0), width: 2),
                          ),
                        ),
                        child: Text(
                          tr('Authorised personnel only.'),
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                            color: Colors.black87,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _label(String text) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text(
      tr(text),
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.bold,
        color: Colors.black,
      ),
    ),
  );
}

/// Left branded hero — shown at ≥1024px like the web lg breakpoint.
class _HeroPanel extends StatelessWidget {
  const _HeroPanel();

  static final _features = [
    (
      Icons.monitor_heart_outlined,
      tr('Outbreak detection'),
      tr(
        'Real-time mortality surveillance, automated threshold alerts & early cluster warnings',
      ),
      tr('Live Surveillance'),
    ),
    (
      Icons.find_in_page_outlined,
      tr('Tele-pathology'),
      tr(
        'Remote digital specimen review and authenticated digital autopsy certification',
      ),
      tr('Digital Forensics'),
    ),
    (
      Icons.place_outlined,
      tr('GIS analytics'),
      tr(
        'District → provincial → national disease mapping, hotspot heatmaps and spatial mortality patterns',
      ),
      tr('Geospatial Intel'),
    ),
    (
      Icons.wifi_off_outlined,
      tr('Offline field sync'),
      tr(
        'Capture mortality data in the field without connectivity — records queue locally and sync when back online',
      ),
      tr('Field Ready'),
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      color: DdsColors.heroBg,
      padding: const EdgeInsets.all(32),
      child: Center(
        child: SingleChildScrollView(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(
              children: [
                LayoutBuilder(
                  builder: (context, _) {
                    final h = MediaQuery.of(context).size.height;
                    final size = (h * 0.38).clamp(160.0, 416.0);
                    return Container(
                      width: size,
                      height: size,
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: Colors.white.withValues(alpha: 0.2),
                          width: 8,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.4),
                            blurRadius: 32,
                          ),
                        ],
                      ),
                      child: Image.asset(
                        'assets/mohcc-logo.png',
                        fit: BoxFit.contain,
                      ),
                    );
                  },
                ),
                const SizedBox(height: 28),
                Align(
                  alignment: Alignment.centerLeft,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        tr('Disease Detection System'),
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 28,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      SizedBox(height: 4),
                      Text(
                        tr('Ministry of Health and Child Care — Zimbabwe'),
                        style: TextStyle(
                          color: DdsColors.emerald,
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                for (final f in _features)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 14),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 32,
                          height: 32,
                          margin: const EdgeInsets.only(top: 2),
                          decoration: BoxDecoration(
                            color: DdsColors.emerald.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(
                              color: DdsColors.emerald.withValues(alpha: 0.3),
                            ),
                          ),
                          child: Icon(f.$1, size: 16, color: DdsColors.emerald),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Wrap(
                                spacing: 8,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  Text(
                                    tr(f.$2),
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 14,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 8,
                                      vertical: 2,
                                    ),
                                    decoration: BoxDecoration(
                                      color: DdsColors.emerald.withValues(
                                        alpha: 0.15,
                                      ),
                                      borderRadius: BorderRadius.circular(999),
                                      border: Border.all(
                                        color: DdsColors.emerald.withValues(
                                          alpha: 0.3,
                                        ),
                                      ),
                                    ),
                                    child: Text(
                                      tr(f.$4),
                                      style: const TextStyle(
                                        fontSize: 10,
                                        color: DdsColors.emerald,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 2),
                              Text(
                                tr(f.$3),
                                style: TextStyle(
                                  fontSize: 12,
                                  color: Colors.white.withValues(alpha: 0.8),
                                  height: 1.4,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Server status dot — green when the API answers, red when it doesn't,
/// grey while probing. Purely informational; server configuration lives in
/// the admin Facilities page.
class _StatusDot extends StatelessWidget {
  const _StatusDot({required this.up});

  /// null = still probing.
  final bool? up;

  @override
  Widget build(BuildContext context) {
    final color = switch (up) {
      null => DdsColors.mutedForeground,
      true => DdsColors.success,
      false => DdsColors.destructive,
    };
    return Padding(
      padding: const EdgeInsets.all(8),
      child: Container(
        width: 12,
        height: 12,
        decoration: BoxDecoration(
          color: color,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.black26, width: 1),
        ),
      ),
    );
  }
}
