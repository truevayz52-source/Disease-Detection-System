import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../../data/api_client.dart';
import '../../l10n/app_localizations.dart';
import '../../ui/app_shell.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// Outbreak map — port of client/src/pages/analytics-map.tsx.
/// Esri tiles + facility ring markers + category-coloured case dots with
/// the same toggle/legend controls as the web page.
class OutbreakMapScreen extends StatefulWidget {
  const OutbreakMapScreen({super.key});

  static const _categoryColors = [
    Color(0xFFDC2626),
    Color(0xFF2563EB),
    Color(0xFF16A34A),
    Color(0xFFD97706),
    Color(0xFF7C3AED),
    Color(0xFF0891B2),
    Color(0xFFBE185D),
    Color(0xFF65A30D),
  ];

  @override
  State<OutbreakMapScreen> createState() => _OutbreakMapScreenState();
}

class _OutbreakMapScreenState extends State<OutbreakMapScreen> {
  List<dynamic> _facilities = [];
  List<dynamic> _cases = [];
  bool _loading = true;
  Object? _error;
  bool _showCases = true;
  bool _showFacilities = true;
  Set<String>? _activeCategories; // null = all visible

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final res = await context.read<ApiClient>().get('/analytics/geo');
      if (mounted) {
        setState(() {
          _facilities = (res['facilities'] as List?) ?? [];
          _cases = (res['cases'] as List?) ?? [];
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

  List<String> get _categories => [
    ...{for (final c in _cases) '${c['disease_category']}'},
  ]..sort();

  Color _colorOf(String c) {
    final i = _categories.indexOf(c);
    return i < 0
        ? const Color(0xFF64748B)
        : OutbreakMapScreen._categoryColors[i %
              OutbreakMapScreen._categoryColors.length];
  }

  List<Map<String, dynamic>> get _visibleCases {
    final list = _cases.cast<Map<String, dynamic>>();
    if (_activeCategories == null) return list;
    return list
        .where((c) => _activeCategories!.contains('${c['disease_category']}'))
        .toList();
  }

  void _toggleCategory(String c) {
    setState(() {
      final next = {...(_activeCategories ?? _categories.toSet())};
      next.contains(c) ? next.remove(c) : next.add(c);
      _activeCategories = next;
    });
  }

  LatLng? _point(Map<String, dynamic> m) {
    final lat = num.tryParse('${m['latitude']}');
    final lng = num.tryParse('${m['longitude']}');
    if (lat == null || lng == null) return null;
    return LatLng(lat.toDouble(), lng.toDouble());
  }

  @override
  Widget build(BuildContext context) {
    final cases = _visibleCases;
    return AppScaffold(
      title: tr('Outbreak Map'),
      actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      child: _loading
          ? loadingOr(null)
          : _error != null
          ? loadingOr(_error, onRetry: _load)
          : Column(
              children: [
                Expanded(
                  flex: 5,
                  child: FlutterMap(
                    options: const MapOptions(
                      initialCenter: LatLng(-19.0, 29.8),
                      initialZoom: 6,
                    ),
                    children: [
                      TileLayer(
                        urlTemplate:
                            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
                        userAgentPackageName: 'zw.org.mohcc.dds_mobile',
                      ),
                      const SimpleAttributionWidget(
                        source: Text(
                          'Esri, TomTom, Garmin, FAO, NOAA, USGS · © OpenStreetMap contributors',
                          style: TextStyle(fontSize: 10),
                        ),
                      ),
                      if (_showFacilities)
                        CircleLayer(
                          circles: [
                            for (final f
                                in _facilities.cast<Map<String, dynamic>>())
                              if (_point(f) case final p?)
                                CircleMarker(
                                  point: p,
                                  radius: 9,
                                  color: const Color(0xFFF8FAFC)
                                      .withValues(alpha: 0.9),
                                  borderColor: const Color(0xFF0F172A),
                                  borderStrokeWidth: 1.5,
                                ),
                          ],
                        ),
                      if (_showCases)
                        CircleLayer(
                          circles: [
                            for (final c in cases)
                              if (_point(c) case final p?)
                                CircleMarker(
                                  point: p,
                                  radius: 6,
                                  color: _colorOf('${c['disease_category']}')
                                      .withValues(alpha: 0.55),
                                  borderColor: _colorOf(
                                    '${c['disease_category']}',
                                  ),
                                  borderStrokeWidth: 1,
                                ),
                          ],
                        ),
                    ],
                  ),
                ),
                Expanded(
                  flex: 4,
                  child: ListView(
                    padding: const EdgeInsets.all(12),
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: CheckboxListTile(
                              dense: true,
                              contentPadding: EdgeInsets.zero,
                              controlAffinity: ListTileControlAffinity.leading,
                              title: Text(
                                tr('Facilities'),
                                style: const TextStyle(fontSize: 13),
                              ),
                              value: _showFacilities,
                              onChanged: (v) =>
                                  setState(() => _showFacilities = v == true),
                            ),
                          ),
                          Expanded(
                            child: CheckboxListTile(
                              dense: true,
                              contentPadding: EdgeInsets.zero,
                              controlAffinity: ListTileControlAffinity.leading,
                              title: Text(
                                tr('Mortality cases ({n})', {
                                  'n': cases.length,
                                }),
                                style: const TextStyle(fontSize: 13),
                              ),
                              value: _showCases,
                              onChanged: (v) =>
                                  setState(() => _showCases = v == true),
                            ),
                          ),
                        ],
                      ),
                      const Divider(),
                      Text(
                        tr('Disease categories'),
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: DdsColors.mutedForeground,
                        ),
                      ),
                      for (final c in _categories)
                        CheckboxListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          controlAffinity: ListTileControlAffinity.leading,
                          secondary: Container(
                            width: 10,
                            height: 10,
                            decoration: BoxDecoration(
                              color: _colorOf(c),
                              shape: BoxShape.circle,
                            ),
                          ),
                          title: Text(
                            tr(c),
                            style: const TextStyle(fontSize: 12),
                          ),
                          value:
                              _activeCategories == null ||
                              _activeCategories!.contains(c),
                          onChanged: (_) => _toggleCategory(c),
                        ),
                      const Divider(),
                      Text(
                        tr(
                          'Cases are plotted at patient residence (or reporting facility when no address coordinates exist) — spatial clusters indicate possible outbreak zones.',
                        ),
                        style: const TextStyle(
                          fontSize: 11,
                          color: DdsColors.mutedForeground,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
    );
  }
}
