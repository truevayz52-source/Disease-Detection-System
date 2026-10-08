package zw.org.mohcc.dds_mobile

import android.content.Intent
import android.provider.Settings
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

// FlutterFragmentActivity (not FlutterActivity) — local_auth's BiometricPrompt
// needs a FragmentActivity host or every prompt fails with
// PlatformException(no_fragment_activity).
class MainActivity : FlutterFragmentActivity() {
    private val settingsChannel = "zw.org.mohcc.dds_mobile/settings"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            settingsChannel,
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                // Opens device security settings so users can enroll a
                // fingerprint/face when the app reports "not enrolled".
                "openSecuritySettings" -> {
                    val opened = try {
                        startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS))
                        true
                    } catch (_: Exception) {
                        try {
                            startActivity(Intent(Settings.ACTION_SETTINGS))
                            true
                        } catch (_: Exception) {
                            false
                        }
                    }
                    result.success(opened)
                }
                else -> result.notImplemented()
            }
        }
    }
}
