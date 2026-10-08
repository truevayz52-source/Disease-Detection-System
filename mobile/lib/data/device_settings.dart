import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Deep-links into the host OS settings. Android exposes a security-settings
/// screen via a MethodChannel on MainActivity; iOS has no public deep-link to
/// Touch/Face ID enrolment, so we open the app's own settings page instead.
class DeviceSettings {
  static const _channel = MethodChannel('zw.org.mohcc.dds_mobile/settings');

  /// Open the device biometric/security settings so the user can enrol a
  /// fingerprint or face. Returns false when nothing could be opened.
  static Future<bool> openSecuritySettings() async {
    if (kIsWeb) return false;
    try {
      if (Platform.isAndroid) {
        return await _channel.invokeMethod<bool>('openSecuritySettings') ??
            false;
      }
      if (Platform.isIOS) {
        return await _channel.invokeMethod<bool>('openAppSettings') ?? false;
      }
    } catch (_) {
      /* channel missing — fall through */
    }
    return false;
  }
}
