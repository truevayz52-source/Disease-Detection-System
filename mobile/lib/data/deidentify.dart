/// Privacy gate for external translation calls — Dart port of
/// server/src/lib/deidentify.ts (keep in sync). Replaces PII literals and
/// common identifier shapes with numbered placeholders (⟦1⟧ … ⟦n⟧) so the
/// translation provider receives de-identified text only. Callers
/// re-substitute placeholders for display via [unmaskPii].
final _patterns = <RegExp>[
  RegExp(r'\b\d{2}-\d{5,7}[A-Z]\d{2}\b'), // Zimbabwe national ID
  RegExp(r'\b(?:\+263|0)7\d{8}\b'), // ZW mobile numbers
  RegExp(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'), // emails
  RegExp(r'-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}'), // lat,lng pairs
  RegExp(r'\b\d{6,}\b'), // long digit runs (IDs, serials)
];

typedef MaskedText = ({String masked, Map<String, String> map});

MaskedText maskPii(String text, [List<String> extraLiterals = const []]) {
  final map = <String, String>{};
  var masked = text;
  String nextToken() => '⟦${map.length + 1}⟧';
  // Caller-supplied record literals first (longest-first so "Tendai Moyo"
  // masks before a shorter "Moyo" could partially match).
  final lits = [...extraLiterals]
    ..sort((a, b) => b.length.compareTo(a.length));
  for (final lit in lits) {
    final v = lit.trim();
    if (v.length >= 2 && masked.contains(v)) {
      final token = nextToken();
      map[token] = v;
      masked = masked.replaceAll(v, token);
    }
  }
  for (final re in _patterns) {
    masked = masked.replaceAllMapped(re, (m) {
      final token = nextToken();
      map[token] = m.group(0)!;
      return token;
    });
  }
  return (masked: masked, map: map);
}

String unmaskPii(String text, Map<String, String> map) {
  var out = text;
  for (final e in map.entries) {
    out = out.replaceAll(e.key, e.value);
  }
  return out;
}
