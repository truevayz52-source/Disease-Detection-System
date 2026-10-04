import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';

import '../../data/api_client.dart';
import '../../data/auth_repository.dart';
import '../../data/dds_repository.dart';
import '../../data/draft_store.dart';
import '../../data/models.dart';
import '../../ui/app_shell.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

import '../../l10n/app_localizations.dart';

/// Port of client/src/pages/notification-new.tsx — 3-step wizard
/// (demographics → death details → review) with debounced ICD autocomplete,
/// draft autosave and offline queueing on network failure (TC-05).
class NotificationNewScreen extends StatefulWidget {
  const NotificationNewScreen({super.key});

  @override
  State<NotificationNewScreen> createState() => _NotificationNewScreenState();
}

class _NotificationNewScreenState extends State<NotificationNewScreen> {
  static const _steps = [
    'Patient demographics',
    'Death details',
    'Review & submit',
  ];

  final _drafts = DraftStore();
  final _queue = OfflineQueue();
  int _step = 0;
  bool _submitting = false;
  bool _draftRestored = false;

  // form state
  String nationalId = '';
  String fullName = '';
  String age = '';
  String gender = '';
  String residentialAddress = '';
  String latitude = '';
  String longitude = '';
  String facilityId = '';
  String dateOfDeath = '';
  String icdCode = '';
  String icdDesc = '';
  String clinicalSummary = '';
  bool isMaternalPerinatal = false;

  List<Facility> _facilities = [];
  List<IcdCode> _icdItems = [];
  String _icdQuery = '';
  bool _icdSearching = false;

  bool get _step1Valid => fullName.trim().length >= 2 && gender.isNotEmpty;
  bool get _step2Valid =>
      facilityId.isNotEmpty && dateOfDeath.isNotEmpty && icdCode.isNotEmpty;

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final repo = context.read<DdsRepository>();
    try {
      _facilities = await repo.facilities();
    } catch (_) {
      /* keep empty */
    }
    // Restore draft + prefill facility for medical officers.
    final draft = await _drafts.loadDraft();
    if (!mounted) return;
    final user = context.read<AuthRepository>().user;
    if (!mounted) return;
    setState(() {
      if (draft != null) {
        _draftRestored = true;
        nationalId = draft['nationalId'] ?? '';
        fullName = draft['fullName'] ?? '';
        age = draft['age'] ?? '';
        gender = draft['gender'] ?? '';
        residentialAddress = draft['residentialAddress'] ?? '';
        latitude = draft['latitude'] ?? '';
        longitude = draft['longitude'] ?? '';
        facilityId = draft['facilityId'] ?? '';
        dateOfDeath = draft['dateOfDeath'] ?? '';
        icdCode = draft['icdCode'] ?? '';
        icdDesc = draft['icdDesc'] ?? '';
        clinicalSummary = draft['clinicalSummary'] ?? '';
        isMaternalPerinatal = draft['isMaternalPerinatal'] == true;
      }
      if (user?.role == 'medical_officer' &&
          user?.facilityId != null &&
          facilityId.isEmpty) {
        facilityId = user!.facilityId!;
      }
    });
  }

  Map<String, dynamic> _formMap() => {
    'nationalId': nationalId,
    'fullName': fullName,
    'age': age,
    'gender': gender,
    'residentialAddress': residentialAddress,
    'latitude': latitude,
    'longitude': longitude,
    'facilityId': facilityId,
    'dateOfDeath': dateOfDeath,
    'icdCode': icdCode,
    'icdDesc': icdDesc,
    'clinicalSummary': clinicalSummary,
    'isMaternalPerinatal': isMaternalPerinatal,
  };

  void _saveDraft() => _drafts.saveDraft(_formMap());

  Future<void> _searchIcd(String q) async {
    setState(() {
      _icdQuery = q;
      _icdSearching = true;
    });
    try {
      final items = await context.read<DdsRepository>().icdCodes(q);
      if (mounted && _icdQuery == q) {
        setState(() => _icdItems = items);
      }
    } catch (_) {
      /* keep last list */
    } finally {
      if (mounted) setState(() => _icdSearching = false);
    }
  }

  Future<void> _pickDateTime() async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: DateTime(now.year - 5),
      lastDate: now,
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(now),
    );
    if (time == null) return;
    final dt = DateTime(
      date.year,
      date.month,
      date.day,
      time.hour,
      time.minute,
    );
    setState(() => dateOfDeath = dt.toIso8601String());
    _saveDraft();
  }

  Future<void> _submit() async {
    setState(() => _submitting = true);
    final user = context.read<AuthRepository>().user;
    final payload = {
      'submissionId': const Uuid().v4(),
      'patient': {
        'nationalId': nationalId.isEmpty ? null : nationalId,
        'fullName': fullName.trim(),
        'age': age.isEmpty ? null : int.tryParse(age),
        'gender': gender,
        'residentialAddress': residentialAddress.isEmpty
            ? null
            : residentialAddress,
        'latitude': latitude.isEmpty ? null : double.tryParse(latitude),
        'longitude': longitude.isEmpty ? null : double.tryParse(longitude),
      },
      'facilityId': facilityId,
      'dateOfDeath': dateOfDeath,
      'preliminaryIcdCode': icdCode,
      'clinicalSummary': user?.role == 'mortuary_clerk'
          ? null
          : (clinicalSummary.isEmpty ? null : clinicalSummary),
      'isMaternalPerinatal': isMaternalPerinatal,
    };
    try {
      final res = await context.read<DdsRepository>().createNotification(
        payload,
      );
      await _drafts.clearDraft();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            res.mpdsrAlertId != null
                ? tr('MPDSR alert generated for this maternal/perinatal death.')
                : res.alertsCreated > 0
                ? tr('{n} outbreak alert(s) triggered.', {
                    'n': res.alertsCreated,
                  })
                : tr('Death notification recorded.'),
          ),
        ),
      );
      context.pushReplacement('/notifications/${res.notificationId}');
    } on ApiException catch (e) {
      if (e.status == 0) {
        // Offline — queue locally (TC-05 parity)
        await _queue.enqueueNotification(payload);
        await _drafts.clearDraft();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              tr(
                'Network unavailable — record cached locally and will sync on reconnect.',
              ),
            ),
          ),
        );
        context.go('/notifications');
      } else {
        if (!mounted) return;
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'New Death Notification',
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 640),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (_draftRestored && _step == 0)
                    Container(
                      margin: const EdgeInsets.only(bottom: 12),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: DdsColors.muted,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        tr('A saved draft was restored from this device.'),
                        style: TextStyle(
                          fontSize: 12,
                          color: DdsColors.mutedForeground,
                        ),
                      ),
                    ),
                  // step indicator
                  Row(
                    children: [
                      for (var i = 0; i < _steps.length; i++) ...[
                        _StepDot(index: i, current: _step),
                        Expanded(
                          child: Text(
                            tr(_steps[i]),
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: i == _step
                                  ? FontWeight.w600
                                  : FontWeight.normal,
                              color: i == _step
                                  ? DdsColors.foreground
                                  : DdsColors.mutedForeground,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (i < _steps.length - 1)
                          Container(
                            width: 16,
                            height: 1,
                            margin: const EdgeInsets.symmetric(horizontal: 4),
                            color: DdsColors.border,
                          ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 16),
                  if (_step == 0) _stepDemographics(),
                  if (_step == 1) _stepDeathDetails(),
                  if (_step == 2) _stepReview(),
                  const SizedBox(height: 20),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      OutlinedButton.icon(
                        onPressed: _step == 0
                            ? null
                            : () => setState(() => _step--),
                        icon: const Icon(Icons.chevron_left, size: 16),
                        label: Text(tr('Back')),
                      ),
                      if (_step < 2)
                        FilledButton.icon(
                          onPressed: (_step == 0 ? _step1Valid : _step2Valid)
                              ? () => setState(() => _step++)
                              : null,
                          icon: const Icon(Icons.chevron_right, size: 16),
                          label: Text(tr('Next')),
                        )
                      else
                        FilledButton.icon(
                          onPressed: _submitting ? null : _submit,
                          icon: _submitting
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Colors.white,
                                  ),
                                )
                              : const Icon(Icons.check, size: 16),
                          label: Text(tr('Submit notification')),
                        ),
                    ],
                  ),
                  const SizedBox(height: 40),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _stepDemographics() => SectionCard(
    title: 'Patient demographics',
    subtitle: "Deceased person's identity details",
    child: Column(
      children: [
        _field('Full name *', (v) => fullName = v, initial: fullName),
        Row(
          children: [
            Expanded(
              child: _field(
                'National ID',
                (v) => nationalId = v,
                initial: nationalId,
                hint: '63-204918A12',
              ),
            ),
            const SizedBox(width: 12),
            SizedBox(
              width: 90,
              child: _field('Age', (v) => age = v, initial: age, numeric: true),
            ),
          ],
        ),
        _dropdownField('Gender *', gender, const {
          'male': 'Male',
          'female': 'Female',
          'other': 'Other',
        }, (v) => setState(() => gender = v ?? '')),
        _field(
          'Residential address',
          (v) => residentialAddress = v,
          initial: residentialAddress,
        ),
        Row(
          children: [
            Expanded(
              child: _field(
                'Latitude (optional)',
                (v) => latitude = v,
                initial: latitude,
                hint: '-17.82',
                numeric: true,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _field(
                'Longitude (optional)',
                (v) => longitude = v,
                initial: longitude,
                hint: '31.05',
                numeric: true,
              ),
            ),
          ],
        ),
      ],
    ),
  );

  Widget _stepDeathDetails() => SectionCard(
    title: 'Death details',
    subtitle: 'Facility, date/time and preliminary ICD cause',
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          tr('Reporting facility *'),
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
        ),
        const SizedBox(height: 6),
        DropdownButtonFormField<String>(
          initialValue: _facilities.any((f) => f.facilityId == facilityId)
              ? facilityId
              : null,
          decoration: InputDecoration(hintText: tr('Select facility')),
          items: [
            for (final f in _facilities)
              DropdownMenuItem(
                value: f.facilityId,
                child: Text(
                  '${f.facilityName} — ${f.district}',
                  style: const TextStyle(fontSize: 13),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
          ],
          onChanged: (v) {
            setState(() => facilityId = v ?? '');
            _saveDraft();
          },
        ),
        const SizedBox(height: 14),
        Text(
          tr('Date & time of death *'),
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
        ),
        const SizedBox(height: 6),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(
            alignment: Alignment.centerLeft,
            minimumSize: const Size.fromHeight(46),
          ),
          onPressed: _pickDateTime,
          icon: const Icon(Icons.event, size: 18),
          label: Text(
            dateOfDeath.isEmpty
                ? tr('Select date & time')
                : fmtDateTime(dateOfDeath),
            style: const TextStyle(fontSize: 13),
          ),
        ),
        const SizedBox(height: 14),
        Text(
          tr('Preliminary cause of death (ICD-10) *'),
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
        ),
        const SizedBox(height: 6),
        // ICD autocomplete — mirrors the web IcdPicker
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller:
                  TextEditingController(
                      text: icdCode.isEmpty ? _icdQuery : '$icdCode — $icdDesc',
                    )
                    ..selection = TextSelection.collapsed(
                      offset: icdCode.isEmpty
                          ? _icdQuery.length
                          : '$icdCode — $icdDesc'.length,
                    ),
              decoration: InputDecoration(
                hintText: tr('Type ICD code or disease name…'),
                suffixIcon: _icdSearching
                    ? const Padding(
                        padding: EdgeInsets.all(12),
                        child: SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : null,
              ),
              onChanged: (v) {
                // Editing resets the selection so the user re-picks
                if (icdCode.isNotEmpty) {
                  icdCode = '';
                  icdDesc = '';
                }
                _searchIcd(v);
              },
            ),
            if (_icdItems.isNotEmpty && icdCode.isEmpty)
              Container(
                margin: const EdgeInsets.only(top: 4),
                constraints: const BoxConstraints(maxHeight: 220),
                decoration: BoxDecoration(
                  color: Colors.white,
                  border: Border.all(color: DdsColors.border),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: _icdItems.length,
                  itemBuilder: (context, i) {
                    final c = _icdItems[i];
                    return ListTile(
                      dense: true,
                      title: RichText(
                        text: TextSpan(
                          style: const TextStyle(
                            fontSize: 13,
                            color: Colors.black87,
                          ),
                          children: [
                            TextSpan(
                              text: '${c.icdCode}  ',
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            TextSpan(text: c.description),
                          ],
                        ),
                      ),
                      trailing: c.isNotifiable
                          ? Text(
                              tr('notifiable'),
                              style: TextStyle(
                                fontSize: 10,
                                color: DdsColors.destructive,
                              ),
                            )
                          : null,
                      onTap: () => setState(() {
                        icdCode = c.icdCode;
                        icdDesc = c.description;
                        _icdItems = [];
                        _icdQuery = '';
                      }),
                    );
                  },
                ),
              ),
          ],
        ),
        const SizedBox(height: 14),
        Text(
          tr('Clinical summary'),
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
        ),
        const SizedBox(height: 6),
        TextField(
          maxLines: 4,
          controller: TextEditingController(text: clinicalSummary)
            ..selection = TextSelection.collapsed(
              offset: clinicalSummary.length,
            ),
          decoration: InputDecoration(
            hintText: tr('Brief clinical history and circumstances of death…'),
          ),
          onChanged: (v) {
            clinicalSummary = v;
            _saveDraft();
          },
        ),
        const SizedBox(height: 10),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          dense: true,
          value: isMaternalPerinatal,
          onChanged: (v) {
            setState(() => isMaternalPerinatal = v == true);
            _saveDraft();
          },
          title: Text(
            tr('Maternal or perinatal death (triggers MPDSR alert)'),
            style: TextStyle(fontSize: 13),
          ),
          controlAffinity: ListTileControlAffinity.leading,
        ),
      ],
    ),
  );

  Widget _stepReview() {
    final facilityName = _facilities
        .where((f) => f.facilityId == facilityId)
        .map((f) => f.facilityName)
        .firstOrNull;
    return SectionCard(
      title: 'Review & submit',
      subtitle: 'Verify details before committing the record',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InfoRow('Patient', fullName),
          InfoRow('National ID', nationalId.isEmpty ? '—' : nationalId),
          InfoRow('Age / Gender', '${age.isEmpty ? '—' : age} / $gender'),
          InfoRow(
            'Address',
            residentialAddress.isEmpty ? '—' : residentialAddress,
          ),
          InfoRow('Facility', facilityName ?? facilityId),
          InfoRow('Date of death', fmtDateTime(dateOfDeath)),
          InfoRow('Preliminary ICD', '$icdCode — $icdDesc'),
          InfoRow(
            'MPDSR',
            isMaternalPerinatal ? tr('Yes — alert will be raised') : tr('No'),
          ),
          if (clinicalSummary.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              tr('Summary'),
              style: TextStyle(fontSize: 12, color: DdsColors.mutedForeground),
            ),
            const SizedBox(height: 2),
            Text(clinicalSummary, style: const TextStyle(fontSize: 13)),
          ],
        ],
      ),
    );
  }

  Widget _field(
    String label,
    ValueChanged<String> onChanged, {
    String initial = '',
    String? hint,
    bool numeric = false,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            tr(label),
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 6),
          TextFormField(
            initialValue: initial,
            keyboardType: numeric ? TextInputType.number : TextInputType.text,
            decoration: InputDecoration(hintText: hint),
            onChanged: (v) {
              onChanged(v);
              _saveDraft();
            },
          ),
        ],
      ),
    );
  }

  Widget _dropdownField(
    String label,
    String value,
    Map<String, String> options,
    ValueChanged<String?> onChanged,
  ) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            tr(label),
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
          ),
          const SizedBox(height: 6),
          DropdownButtonFormField<String>(
            initialValue: value.isEmpty ? null : value,
            decoration: InputDecoration(hintText: tr('Select')),
            items: [
              for (final e in options.entries)
                DropdownMenuItem(
                  value: e.key,
                  child: Text(
                    tr(e.value),
                    style: const TextStyle(fontSize: 13),
                  ),
                ),
            ],
            onChanged: (v) {
              onChanged(v);
              _saveDraft();
            },
          ),
        ],
      ),
    );
  }
}

class _StepDot extends StatelessWidget {
  const _StepDot({required this.index, required this.current});
  final int index;
  final int current;

  @override
  Widget build(BuildContext context) {
    final done = index < current;
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: Container(
        width: 20,
        height: 20,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: done ? DdsColors.primary : Colors.white,
          border: Border.all(
            color: done ? DdsColors.primary : const Color(0xFF94A3B8),
          ),
        ),
        child: Center(
          child: done
              ? const Icon(Icons.check, size: 12, color: Colors.white)
              : Text(
                  '${index + 1}',
                  style: const TextStyle(fontSize: 10, color: Colors.black54),
                ),
        ),
      ),
    );
  }
}
