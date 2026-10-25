#!/usr/bin/env node
// Publishes the current public API URL to the repo's `tunnel-pointer` branch
// so the mobile app (ServerResolver → DDS_LOOKUP_URL, pointed at the raw file)
// always finds the server after a Cloudflare quick-tunnel restart.
//
//   node deploy/sync-tunnel-github.mjs <REPO_GIT_URL> <API_URL>
//
//   REPO_GIT_URL  e.g. https://github.com/<owner>/<repo>.git
//   API_URL       e.g. https://<sub>.trycloudflare.com/api
//
// Auth model: the local git credential helper supplies credentials — no
// Firebase project or extra account needed. The pointer file is a bare JSON
// string so the app's plain GET + jsonDecode works against raw.githubusercontent.com.
//
// The app reads:  https://raw.githubusercontent.com/<owner>/<repo>/tunnel-pointer/api_url.json

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [repoUrl, apiUrl] = process.argv.slice(2);
if (!repoUrl || !apiUrl) {
  console.error(
    "usage: node deploy/sync-tunnel-github.mjs <REPO_GIT_URL> <API_URL>",
  );
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "dds-pointer-"));
const git = (args) =>
  execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();

try {
  execFileSync(
    "git",
    ["clone", "--depth", "1", "--single-branch", "--branch", "tunnel-pointer", repoUrl, dir],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const file = join(dir, "api_url.json");
  const next = JSON.stringify(apiUrl);
  let prev = "";
  try {
    prev = readFileSync(file, "utf8").trim();
  } catch {
    /* first publish */
  }
  if (prev === next) {
    console.log(`[sync-tunnel-github] already ${apiUrl}`);
    process.exit(0);
  }

  writeFileSync(file, `${next}\n`);
  git(["add", "api_url.json"]);
  git(["-c", "user.email=tunnel-pointer@dds.local", "-c", "user.name=dds-tunnel",
       "commit", "-qm", "update tunnel pointer"]);
  git(["push", "origin", "tunnel-pointer"]);
  console.log(`[sync-tunnel-github] published ${apiUrl}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
