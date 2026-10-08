#!/usr/bin/env node
// Publishes the current public API URL to Firebase Realtime Database so the
// mobile app (ServerResolver → DDS_LOOKUP_URL) always finds the server after
// a Cloudflare quick-tunnel restart.
//
//   node deploy/sync-tunnel-url.mjs <RTDB_URL> <WEB_API_KEY> <API_URL>
//
//   RTDB_URL     e.g. https://<project>-default-rtdb.firebaseio.com
//   WEB_API_KEY  Firebase project settings → General → Web API key
//   API_URL      e.g. https://<sub>.trycloudflare.com/api
//
// Auth model: anonymous sign-in → idToken; RTDB rules should be
//   { "rules": { "dds": { ".read": true, ".write": "auth != null" } } }
// Anyone can read the URL; only an authenticated writer can change it.

const [rtdbUrl, apiKey, apiUrl] = process.argv.slice(2);

if (!rtdbUrl || !apiKey || !apiUrl) {
  console.error(
    "usage: node deploy/sync-tunnel-url.mjs <RTDB_URL> <WEB_API_KEY> <API_URL>",
  );
  process.exit(1);
}

const authRes = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  },
);
if (!authRes.ok) {
  throw new Error(`anonymous sign-in failed: ${authRes.status} ${await authRes.text()}`);
}
const { idToken } = await authRes.json();

const put = await fetch(
  `${rtdbUrl.replace(/\/$/, "")}/dds/api_url.json?auth=${idToken}`,
  { method: "PUT", body: JSON.stringify(apiUrl) },
);
if (!put.ok) {
  throw new Error(`RTDB write failed: ${put.status} ${await put.text()}`);
}
console.log(`[sync-tunnel-url] published ${apiUrl}`);
