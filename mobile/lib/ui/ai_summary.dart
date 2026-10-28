import 'package:flutter/material.dart';

class AiSummary extends StatelessWidget {
  const AiSummary(this.text, {super.key, this.pii = const []});

  final String text;
  final List<String> pii;

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}
