import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';

import 'device_settings.dart';
import 'offline_accounts.dart';
import '../l10n/app_localizations.dart';

void _log(String msg) => debugPrint('[biometric_auth] $msg');

/// What the device can do right now — drives the Profile security card.
enum BiometricStatus {
  /// No hardware/API at all (emulator without fingerprint, desktop).
  unavailable,

  /// Hardware exists but the user hasn't enrolled a fingerprint/face —
  /// the fix lives in device settings (see [openSecuritySettings]).
  notEnrolled,

  /// At least one biometric credential is enrolled and usable.
  ready,
}

/// Device biometric / Face ID / fingerprint authentication for offline
/// sign-in. This does not store a biometric secret on the device; it uses
/// the OS biometric prompt to unlock the already-encrypted offline account
/// snapshot (mirrors DHIS2's local-credential unlocking).
class BiometricAuth {
  static final _localAuth = LocalAuthentication();

  /// Hardware + enrolment state. `notEnrolled` is the important middle case:
  /// a device *can* do biometrics but the user hasn't set one up yet.
  static Future<BiometricStatus> get status async {
    try {
      final supported = await _localAuth.isDeviceSupported();
      if (!supported) return BiometricStatus.unavailable;
      final enrolled = await _localAuth.getAvailableBiometrics();
      return enrolled.isEmpty
          ? BiometricStatus.notEnrolled
          : BiometricStatus.ready;
    } on LocalAuthException catch (e) {
      _log('status check failed: $e');
      return BiometricStatus.unavailable;
    } on PlatformException catch (e) {
      _log('status check failed: $e');
      return BiometricStatus.unavailable;
    } on MissingPluginException {
      return BiometricStatus.unavailable;
    }
  }

  /// True when the device has at least one enrolled biometric credential.
  static Future<bool> get isAvailable async =>
      await status == BiometricStatus.ready;

  /// Open the OS security/biometric settings so the user can enrol a
  /// fingerprint or face. Wired through the native settings channel.
  static Future<bool> openSecuritySettings() =>
      DeviceSettings.openSecuritySettings();

  /// True when this account's offline blob is marked for biometric unlock.
  static Future<bool> isEnabled(String email) async {
    final acct = await OfflineAccountStore().getAccount(email);
    return acct?.biometricEnabled == true;
  }

  /// Enable biometric unlock for an account after the user proves ownership
  /// once with the device credential. Returns false if the prompt is
  /// cancelled or the device has no biometrics enrolled.
  static Future<bool> enroll(String email) async {
    final acct = await OfflineAccountStore().getAccount(email);
    if (acct == null || acct.has2fa) return false;
    if (acct.biometricEnabled) return true;
    // Prompting on a device with nothing enrolled just errors out — leave
    // the flag off; the Profile security card offers the settings deep-link.
    if (await status != BiometricStatus.ready) return false;

    final ok = await _authenticate(
      tr('Set up biometric sign-in for offline access'),
    );
    if (ok) {
      await OfflineAccountStore().setBiometricEnabled(email, true);
    }
    return ok;
  }

  /// Turn biometric unlock off for an account (Profile switch).
  static Future<void> disable(String email) =>
      OfflineAccountStore().setBiometricEnabled(email, false);

  /// Prompt the OS biometric / passcode dialog and, if successful, return
  /// the stored offline account snapshot. Returns null on cancellation,
  /// failure, or if biometric is not enabled for this account. Throws
  /// [OfflineAuthException] when the offline session has expired.
  static Future<OfflineAccount?> authenticate(String email) async {
    final acct = await OfflineAccountStore().getAccount(email);
    if (acct == null || acct.biometricEnabled != true) return null;
    if (DateTime.now().difference(acct.lastOnlineAt) >
        OfflineAccountStore.offlineSessionTtl) {
      throw OfflineAuthException(
        OfflineAuthError.sessionExpired,
        tr(
          'Offline session expired — connect to the internet to sign in again.',
        ),
      );
    }

    final ok = await _authenticate(tr('Confirm your identity to sign in'));
    if (!ok) return null;
    return acct;
  }

  static Future<bool> _authenticate(String localizedReason) async {
    try {
      return await _localAuth.authenticate(
        localizedReason: localizedReason,
        biometricOnly: false,
        persistAcrossBackgrounding: true,
      );
    } on LocalAuthException catch (e) {
      _log('prompt failed: $e');
      return false;
    } on PlatformException catch (e) {
      _log('prompt failed: $e');
      return false;
    }
  }
}
