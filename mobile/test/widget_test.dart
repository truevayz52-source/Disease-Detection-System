import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:dds_mobile/app.dart';

void main() {
  testWidgets('App boots to the sign-in screen', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(const DdsApp());
    // Session restore resolves asynchronously → redirect to /sign-in.
    await tester.pumpAndSettle();

    expect(find.text('Sign in to DDS'), findsOneWidget);
  });
}
