import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../data/api_client.dart';
import '../data/server_resolver.dart';
import '../data/sync_service.dart';
import '../l10n/app_localizations.dart';
import 'theme.dart';

/// Lets users see and change the server address at runtime — opened from
/// the sign-in screen gear (pre-auth) and the Profile screen. Supports
/// manual entry, a test-connection probe and automatic LAN discovery
/// (UDP beacon + subnet scan).
class ServerSettingsSheet extends StatefulWidget {
  const ServerSettingsSheet({super.key});

  /// Show the sheet; returns after it is dismissed.
  static Future<void> show(BuildContext context) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const ServerSettingsSheet(),
    );
  }

  @override
  State<ServerSettingsSheet> createState() => _ServerSettingsSheetState();
}

class _ServerSettingsSheetState extends State<ServerSettingsSheet> {
  late final TextEditingController _url;
  late final Future<String?> _saved;
  String? _status;
  bool _statusOk = false;
  bool _busy = false;
  List<String> _found = const [];

  @override
  void initState() {
    super.initState();
    _url = TextEditingController(text: context.read<ApiClient>().baseUrl);
    _saved = ServerResolver.savedOverride();
  }

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  Future<void> _test() async {
    setState(() {
      _busy = true;
      _status = null;
      _found = const [];
    });
    final ok = await ServerResolver.probe(
      _url.text,
      timeout: const Duration(seconds: 4),
    );
    if (!mounted) return;
    setState(() {
      _busy = false;
      _statusOk = ok;
      _status = ok
          ? tr('Server reachable')
          : tr('No DDS server answered at this address');
    });
  }

  Future<void> _discover() async {
    setState(() {
      _busy = true;
      _status = null;
    });
    final found = await ServerResolver.discoverOnLan();
    if (!mounted) return;
    setState(() {
      _busy = false;
      _found = found;
      if (found.isEmpty) {
        _statusOk = false;
        _status = tr('No server found on this network');
      } else {
        _statusOk = true;
        _status = tr('Found {n} server(s) — tap to select', {
          'n': found.length,
        });
        _url.text = found.first;
      }
    });
  }

  Future<void> _save() async {
    final api = context.read<ApiClient>();
    if (!await api.setBaseUrl(_url.text)) {
      setState(() {
        _statusOk = false;
        _status = tr(
          'Enter a valid address, e.g. http://192.168.1.10:4001/api',
        );
      });
      return;
    }
    _probeAfterChange();
    if (mounted) Navigator.pop(context);
  }

  void _probeAfterChange() {
    try {
      unawaited(context.read<SyncService>().probe());
    } catch (_) {
      /* provider absent (e.g. unit tests) */
    }
  }

  Future<void> _reset() async {
    final api = context.read<ApiClient>();
    final url = await api.resetBaseUrl();
    if (!mounted) return;
    setState(() {
      _url.text = url;
      _status = tr('Reset to default');
      _statusOk = true;
    });
    _probeAfterChange();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            tr('Server connection'),
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 4),
          Text(
            tr(
              'Address of the DDS server. Ask your IT administrator or use '
              'automatic discovery on the facility network.',
            ),
            style: const TextStyle(
              fontSize: 12,
              color: DdsColors.mutedForeground,
            ),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _url,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: InputDecoration(
              labelText: tr('Server address'),
              hintText: 'http://192.168.1.10:4001/api',
              border: const OutlineInputBorder(),
              isDense: true,
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busy ? null : _test,
                  icon: const Icon(Icons.wifi_tethering, size: 16),
                  label: Text(tr('Test connection')),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busy ? null : _discover,
                  icon: const Icon(Icons.travel_explore, size: 16),
                  label: Text(tr('Find automatically')),
                ),
              ),
            ],
          ),
          if (_busy)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Center(
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            ),
          if (_status != null && !_busy)
            Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Text(
                _status!,
                style: TextStyle(
                  fontSize: 12,
                  color: _statusOk ? DdsColors.success : DdsColors.severityHigh,
                ),
              ),
            ),
          if (_found.length > 1)
            for (final url in _found)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.dns_outlined, size: 18),
                title: Text(url, style: const TextStyle(fontSize: 13)),
                onTap: () => setState(() => _url.text = url),
              ),
          const SizedBox(height: 12),
          Row(
            children: [
              TextButton(
                onPressed: _busy ? null : _reset,
                child: Text(tr('Reset to default')),
              ),
              const Spacer(),
              FutureBuilder<String?>(
                future: _saved,
                builder: (context, snap) => FilledButton(
                  onPressed: _busy ? null : _save,
                  child: Text(
                    snap.data == _url.text.trim() ? tr('Done') : tr('Save'),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
