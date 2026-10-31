import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart' hide InputDecoration, Text, TextSpan;
import 'package:dds_mobile/l10n/localized_widgets.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:record/record.dart';

import '../../data/api_client.dart';
import '../../data/deidentify.dart';
import '../../data/mutation_service.dart';
import '../../l10n/app_localizations.dart';
import '../../ui/app_shell.dart';
import '../../ui/theme.dart';
import '../../ui/translated_text.dart';
import '../../ui/widgets.dart';

/// Verbal Autopsy — port of VoicePage + AudioTranscription + VoiceExtract in
/// client/src/pages/operations.tsx and components/inference-tools.tsx.
///
/// Mobile capture path: record on the mic (record package) or pick an audio
/// file, then upload to POST /voice/transcribe (server-side Whisper) — same
/// endpoint the web uses for file upload. The transcript stays editable and
/// is saved via POST /voice/save; AI field extraction mirrors VoiceExtract.
class VoiceAutopsyScreen extends StatefulWidget {
  const VoiceAutopsyScreen({super.key});

  @override
  State<VoiceAutopsyScreen> createState() => _VoiceAutopsyScreenState();
}

class _VoiceAutopsyScreenState extends State<VoiceAutopsyScreen> {
  static const _fieldLabels = <(String, String)>[
    ('full_name', 'Full name'),
    ('age_years', 'Age (years)'),
    ('gender', 'Gender'),
    ('date_of_death', 'Date of death'),
    ('place_of_death', 'Place of death'),
    ('address', 'Address'),
    ('circumstances', 'Circumstances'),
    ('symptoms', 'Symptoms'),
    ('suspected_cause', 'Suspected cause'),
    ('suggested_icd10', 'Suggested ICD-10'),
    ('maternal_or_perinatal', 'Maternal / perinatal'),
  ];

  final _recorder = AudioRecorder();
  final _text = TextEditingController();
  List<dynamic> _cases = [];
  bool _loading = true;
  Object? _error;
  String? _notificationId;
  String _language = 'en';
  bool _voiceConfigured = false;
  bool _recording = false;
  int _elapsed = 0;
  Timer? _timer;
  bool _transcribing = false;
  Map<String, dynamic>? _fields;
  bool _extracting = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _recorder.dispose();
    _text.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = context.read<ApiClient>();
      final cases = await api.get('/notifications');
      Map<String, dynamic>? status;
      try {
        status = await api.get(
          '/voice/status',
          useCache: false,
        ) as Map<String, dynamic>?;
      } catch (_) {
        status = null;
      }
      if (mounted) {
        setState(() {
          _cases = (cases['items'] as List?) ?? [];
          _voiceConfigured = status?['configured'] == true;
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

  Map<String, dynamic>? get _selectedCase {
    for (final c in _cases.cast<Map<String, dynamic>>()) {
      if ('${c['notification_id']}' == _notificationId) return c;
    }
    return null;
  }

  /// PII literals of the selected case — masked before /ai/extract, matching
  /// the web page's VoiceExtract pii list.
  List<String> get _pii => [
    '${_selectedCase?['patient_name'] ?? ''}',
    '${_selectedCase?['national_id'] ?? ''}',
    '${_selectedCase?['facility_name'] ?? ''}',
  ];

  void _snack(String m) {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
    }
  }

  void _appendText(String t) {
    _text.text = [_text.text, t].where((s) => s.trim().isNotEmpty).join(' ');
    setState(() => _fields = null);
  }

  Future<void> _toggleRecord() async {
    if (_recording) {
      final path = await _recorder.stop();
      _timer?.cancel();
      setState(() => _recording = false);
      if (path != null) await _transcribeFile(path);
      return;
    }
    if (_notificationId == null) {
      _snack(tr('Select a case first'));
      return;
    }
    if (!_voiceConfigured) {
      _snack(tr('The transcription service is not configured'));
      return;
    }
    if (!await _recorder.hasPermission()) {
      _snack(tr('Microphone permission denied'));
      return;
    }
    final dir = await getTemporaryDirectory();
    final path = '${dir.path}/va-${DateTime.now().millisecondsSinceEpoch}.m4a';
    await _recorder.start(
      const RecordConfig(encoder: AudioEncoder.aacLc),
      path: path,
    );
    setState(() {
      _recording = true;
      _elapsed = 0;
    });
    _timer = Timer.periodic(
      const Duration(seconds: 1),
      (_) => setState(() => _elapsed++),
    );
  }

  Future<void> _pickAudio() async {
    if (_notificationId == null) {
      _snack(tr('Select a case first'));
      return;
    }
    final file = await FilePicker.pickFile(type: FileType.audio);
    final path = file?.path;
    if (path != null) await _transcribeFile(path);
  }

  Future<void> _transcribeFile(String path) async {
    setState(() => _transcribing = true);
    try {
      final res = await context.read<ApiClient>().postMultipart(
        '/voice/transcribe',
        path,
        fields: {'notificationId': _notificationId!, 'language': _language},
      );
      _appendText('${res['text'] ?? ''}');
      _snack(tr('Audio transcribed — review before saving'));
      try {
        await File(path).delete();
      } catch (_) {
        /* temp cleanup best-effort */
      }
    } catch (e) {
      _snack('$e');
    } finally {
      if (mounted) setState(() => _transcribing = false);
    }
  }

  /// AI field extraction — mirrors VoiceExtract: mask PII literals first,
  /// the server re-verifies masking before the provider sees anything.
  Future<void> _extract() async {
    final text = _text.text.trim();
    if (text.isEmpty) return;
    setState(() => _extracting = true);
    try {
      final masked = maskPii(text, _pii);
      final res = await context.read<ApiClient>().post(
        '/ai/extract',
        body: {'text': masked.masked, 'pii': _pii},
      );
      final fields = _unmaskDeep(res['fields'], masked.map);
      if (mounted) {
        setState(
          () =>
              _fields = fields is Map ? Map<String, dynamic>.from(fields) : {},
        );
      }
    } catch (e) {
      _snack('$e');
    } finally {
      if (mounted) setState(() => _extracting = false);
    }
  }

  dynamic _unmaskDeep(dynamic v, Map<String, String> map) {
    if (v is String) return unmaskPii(v, map);
    if (v is List) return v.map((e) => _unmaskDeep(e, map)).toList();
    if (v is Map) {
      return v.map((k, val) => MapEntry(k, _unmaskDeep(val, map)));
    }
    return v;
  }

  Future<void> _save() async {
    if (_notificationId == null) {
      _snack(tr('Select a case first'));
      return;
    }
    try {
      // Transcript capture must not wait for connectivity — queue it.
      final res = await context.read<MutationService>().http(
        'POST',
        '/voice/save',
        body: {
          'notificationId': _notificationId,
          'text': _text.text,
          'language': _language,
        },
        entityType: 'death_notification',
        entityId: _notificationId!,
        coalesceKey: 'voice_transcript:$_notificationId',
      );
      _snack(
        res.status == MutationStatus.queued
            ? tr('Offline — transcript queued for sync')
            : tr('Transcript saved'),
      );
      throwIfFailed(res);
    } catch (e) {
      _snack('$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: tr('Verbal Autopsy'),
      actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      child: _loading
          ? loadingOr(null)
          : _error != null
          ? loadingOr(_error, onRetry: _load)
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(
                  tr(
                    'Capture an editable interview transcript. Recordings are transcribed through the Whisper service; clinical review is required.',
                  ),
                  style: const TextStyle(
                    fontSize: 12,
                    color: DdsColors.mutedForeground,
                  ),
                ),
                const SizedBox(height: 12),
                SectionCard(
                  title: tr('Interview transcript'),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      DropdownButtonFormField<String>(
                        initialValue: _notificationId,
                        isExpanded: true,
                        decoration: InputDecoration(
                          labelText: tr('Case'),
                          hintText: tr('Select an existing notification'),
                        ),
                        items: [
                          for (final n in _cases.cast<Map<String, dynamic>>())
                            DropdownMenuItem(
                              value: '${n['notification_id']}',
                              child: Text(
                                '${n['patient_name']} — ${n['facility_name']}',
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontSize: 13),
                              ),
                            ),
                        ],
                        onChanged: (v) => setState(() => _notificationId = v),
                      ),
                      const SizedBox(height: 10),
                      DropdownButtonFormField<String>(
                        initialValue: _language,
                        decoration: InputDecoration(labelText: tr('Language')),
                        items: [
                          DropdownMenuItem(
                            value: 'en',
                            child: Text(tr('English')),
                          ),
                          DropdownMenuItem(
                            value: 'sn',
                            child: Text(tr('Shona')),
                          ),
                          DropdownMenuItem(
                            value: 'nd',
                            child: Text(tr('Ndebele')),
                          ),
                        ],
                        onChanged: (v) => setState(() => _language = v ?? 'en'),
                      ),
                      const SizedBox(height: 12),
                      if (_language == 'nd')
                        Text(
                          tr(
                            'Ndebele is not supported by the transcription engine — type or paste the transcript below.',
                          ),
                          style: const TextStyle(
                            fontSize: 12,
                            color: DdsColors.mutedForeground,
                          ),
                        )
                      else ...[
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                onPressed: _transcribing ? null : _toggleRecord,
                                icon: Icon(
                                  _recording ? Icons.stop : Icons.mic,
                                  size: 16,
                                  color: _recording
                                      ? DdsColors.destructive
                                      : null,
                                ),
                                label: Text(
                                  _recording
                                      ? tr('Stop and transcribe')
                                      : tr('Record interview'),
                                  style: const TextStyle(fontSize: 12),
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: OutlinedButton.icon(
                                onPressed: _transcribing || _recording
                                    ? null
                                    : _pickAudio,
                                icon: const Icon(Icons.upload_file, size: 16),
                                label: Text(
                                  tr('Upload audio'),
                                  style: const TextStyle(fontSize: 12),
                                ),
                              ),
                            ),
                          ],
                        ),
                        if (_recording)
                          Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Text(
                              '${_elapsed ~/ 60}:${(_elapsed % 60).toString().padLeft(2, '0')} ${tr('recording…')}',
                              style: const TextStyle(
                                fontSize: 12,
                                color: DdsColors.destructive,
                              ),
                            ),
                          ),
                        if (_transcribing)
                          Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Row(
                              children: [
                                const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Text(
                                  tr('Transcribing…'),
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: DdsColors.mutedForeground,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        if (!_voiceConfigured)
                          Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Text(
                              tr(
                                'Transcription service is not configured — upload and recording are disabled.',
                              ),
                              style: const TextStyle(
                                fontSize: 11,
                                color: DdsColors.mutedForeground,
                              ),
                            ),
                          ),
                        if (_language == 'sn')
                          Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Text(
                              tr(
                                'Shona transcription accuracy is limited — review the output carefully against the audio.',
                              ),
                              style: const TextStyle(
                                fontSize: 11,
                                color: DdsColors.mutedForeground,
                              ),
                            ),
                          ),
                      ],
                      const SizedBox(height: 10),
                      TextField(
                        controller: _text,
                        maxLines: 10,
                        maxLength: 16000,
                        onChanged: (_) => setState(() => _fields = null),
                        decoration: InputDecoration(
                          labelText: tr('Reviewed transcript'),
                          alignLabelWithHint: true,
                          border: const OutlineInputBorder(),
                        ),
                      ),
                      if (_text.text.trim().isNotEmpty) ...[
                        Container(
                          width: double.infinity,
                          margin: const EdgeInsets.only(bottom: 10),
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            border: Border.all(
                              color: DdsColors.border,
                              style: BorderStyle.solid,
                            ),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                tr('Translated preview').toUpperCase(),
                                style: const TextStyle(
                                  fontSize: 10,
                                  fontWeight: FontWeight.w600,
                                  letterSpacing: 0.8,
                                  color: DdsColors.mutedForeground,
                                ),
                              ),
                              const SizedBox(height: 4),
                              TranslatedText(_text.text, pii: _pii),
                            ],
                          ),
                        ),
                        OutlinedButton.icon(
                          onPressed: _extracting ? null : _extract,
                          icon: _extracting
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.auto_awesome, size: 15),
                          label: Text(
                            _extracting
                                ? tr('Extracting…')
                                : tr('Extract structured fields with AI'),
                            style: const TextStyle(fontSize: 12),
                          ),
                        ),
                        if (_fields != null) _fieldsCard(),
                      ],
                      const SizedBox(height: 12),
                      FilledButton(
                        onPressed: _save,
                        child: Text(tr('Save reviewed transcript')),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 40),
              ],
            ),
    );
  }

  Widget _fieldsCard() {
    final entries = <Widget>[];
    for (final (key, label) in _fieldLabels) {
      final v = _fields![key];
      if (v == null || '$v' == '') continue;
      entries.add(
        InfoRow(
          tr(label),
          v is List
              ? v.join(', ')
              : v == true
              ? tr('Yes')
              : v == false
              ? tr('No')
              : '$v',
        ),
      );
    }
    if (entries.isEmpty) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: DdsColors.muted.withValues(alpha: 0.4),
        border: Border.all(color: DdsColors.border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ...entries,
          Row(
            children: [
              const Icon(
                Icons.auto_awesome,
                size: 12,
                color: DdsColors.mutedForeground,
              ),
              const SizedBox(width: 4),
              Expanded(
                child: Text(
                  tr(
                    'AI-generated draft — verify each field against the transcript before copying into the record',
                  ),
                  style: const TextStyle(
                    fontSize: 10,
                    color: DdsColors.mutedForeground,
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
