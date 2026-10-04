import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:dds_mobile/data/offline_accounts.dart';

const _user = {
  'userId': 'u1',
  'email': 'a@mohcc.org.zw',
  'name': 'Test User',
  'role': 'medical_officer',
};

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('save + verify round-trips a password verifier', () async {
    final store = OfflineAccountStore();
    await store.save(
      email: 'A@MOHCC.org.zw', // normalized on write
      password: 'password123',
      user: _user,
      token: 'jwt-token',
    );

    final acct = await store.verify('a@mohcc.org.zw', 'password123');
    expect(acct.token, 'jwt-token');
    expect(acct.user['userId'], 'u1');
  });

  test('wrong password is rejected', () async {
    final store = OfflineAccountStore();
    await store.save(
      email: 'a@mohcc.org.zw',
      password: 'password123',
      user: _user,
      token: 'jwt-token',
    );

    expect(
      () => store.verify('a@mohcc.org.zw', 'wrong'),
      throwsA(
        isA<OfflineAuthException>().having(
          (e) => e.kind,
          'kind',
          OfflineAuthError.wrongPassword,
        ),
      ),
    );
  });

  test('unknown account is rejected', () async {
    final store = OfflineAccountStore();
    expect(
      () => store.verify('ghost@mohcc.org.zw', 'pw'),
      throwsA(
        isA<OfflineAuthException>().having(
          (e) => e.kind,
          'kind',
          OfflineAuthError.accountNotFound,
        ),
      ),
    );
  });

  test('2FA accounts are stored but refused offline', () async {
    final store = OfflineAccountStore();
    await store.save(
      email: 'a@mohcc.org.zw',
      password: 'password123',
      user: _user,
      token: 'jwt-token',
      has2fa: true,
    );

    expect(
      () => store.verify('a@mohcc.org.zw', 'password123'),
      throwsA(
        isA<OfflineAuthException>().having(
          (e) => e.kind,
          'kind',
          OfflineAuthError.twoFactorRequired,
        ),
      ),
    );
  });

  test('clearToken keeps verifier but drops the JWT', () async {
    final store = OfflineAccountStore();
    await store.save(
      email: 'a@mohcc.org.zw',
      password: 'password123',
      user: _user,
      token: 'jwt-token',
    );
    await store.clearToken('a@mohcc.org.zw');

    final acct = await store.verify('a@mohcc.org.zw', 'password123');
    expect(acct.token, isNull);
  });

  test('remove deletes the account entirely', () async {
    final store = OfflineAccountStore();
    await store.save(
      email: 'a@mohcc.org.zw',
      password: 'password123',
      user: _user,
      token: 'jwt-token',
    );
    await store.remove('a@mohcc.org.zw');

    expect(await store.exists('a@mohcc.org.zw'), isFalse);
    expect(
      () => store.verify('a@mohcc.org.zw', 'password123'),
      throwsA(isA<OfflineAuthException>()),
    );
  });

  test('offline sign-in is refused after the 14-day window', () async {
    final store = OfflineAccountStore();
    await store.save(
      email: 'a@mohcc.org.zw',
      password: 'password123',
      user: _user,
      token: 'jwt-token',
    );

    // In the test environment SecureStore degrades to SharedPreferences
    // under the 'sec:' prefix — age the blob past the TTL.
    final prefs = await SharedPreferences.getInstance();
    const key = 'sec:dds_offline_account:a@mohcc.org.zw';
    final blob = jsonDecode(prefs.getString(key)!) as Map<String, dynamic>;
    final old = DateTime.now().subtract(const Duration(days: 15));
    blob['lastOnlineAt'] = old.toIso8601String();
    blob['savedAt'] = old.toIso8601String();
    await prefs.setString(key, jsonEncode(blob));

    expect(
      () => store.verify('a@mohcc.org.zw', 'password123'),
      throwsA(
        isA<OfflineAuthException>().having(
          (e) => e.kind,
          'kind',
          OfflineAuthError.sessionExpired,
        ),
      ),
    );
  });

  test('a recent lastOnlineAt still signs in offline', () async {
    final store = OfflineAccountStore();
    await store.save(
      email: 'a@mohcc.org.zw',
      password: 'password123',
      user: _user,
      token: 'jwt-token',
    );

    final prefs = await SharedPreferences.getInstance();
    const key = 'sec:dds_offline_account:a@mohcc.org.zw';
    final blob = jsonDecode(prefs.getString(key)!) as Map<String, dynamic>;
    blob['lastOnlineAt'] = DateTime.now()
        .subtract(const Duration(days: 13))
        .toIso8601String();
    await prefs.setString(key, jsonEncode(blob));

    final acct = await store.verify('a@mohcc.org.zw', 'password123');
    expect(acct.user['userId'], 'u1');
  });
}
