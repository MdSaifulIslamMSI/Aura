#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStudentPackEnv } from './lib/student-pack-env.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
loadStudentPackEnv();
const appDist = join(repoRoot, 'app', 'dist');
// Release correlation contract: the frontend reports
// VITE_SENTRY_RELEASE || releaseInfo.id (VITE_RELEASE_ID || git short SHA),
// so the upload must use the same string. In CI set
// SENTRY_RELEASE and VITE_RELEASE_ID to the same value (e.g. $GITHUB_SHA)
// before building, then run this script after `npm --prefix app run build`.
const release = process.env.SENTRY_RELEASE
  || process.env.VITE_SENTRY_RELEASE
  || process.env.VITE_RELEASE_ID
  || process.env.GITHUB_SHA
  || spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
const sentryCommand = process.platform === 'win32' ? 'sentry-cli.cmd' : 'sentry-cli';

const missing = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECT'].filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing ${missing.join(', ')}. Put them in Doppler or the shell before running Sentry release upload.`);
  process.exit(1);
}

if (!release) {
  console.error('Could not resolve a Sentry release id.');
  process.exit(1);
}

// The release id reaches `cmd.exe /c sentry-cli.cmd <args>` on Windows, so
// restrict it to the Sentry release charset before any spawn (CodeQL
// js/indirect-command-line-injection). Sentry release names are
// alphanumerics plus . _ + @ / — this rejects every shell metacharacter.
if (!/^[A-Za-z0-9][A-Za-z0-9._+@/-]{0,199}$/.test(release)) {
  console.error(`Refusing unsafe Sentry release id: ${JSON.stringify(release.slice(0, 64))}`);
  process.exit(1);
}

const isWindows = process.platform === 'win32';
const run = (args, { allowFailure = false } = {}) => {
  // .cmd shims cannot be spawned directly on Windows (EINVAL); route through
  // cmd.exe like scripts/student-pack-cli-doctor.mjs does. The release id
  // reaches argv only after the strict charset validation above, which
  // rejects every shell metacharacter, so it cannot alter command parsing on
  // either platform. (sentry-cli has no SENTRY_RELEASE env fallback for
  // `releases new <VERSION>` — the positional argument is required; passing
  // it via env alone made the CLI fail with "required arguments were not
  // provided" on CI.)
  const childEnv = { ...process.env, SENTRY_RELEASE: release };
  const result = isWindows
    ? spawnSync('cmd.exe', ['/d', '/c', sentryCommand, ...args], {
      cwd: repoRoot,
      env: childEnv,
      stdio: 'inherit',
      windowsHide: true,
    })
    : spawnSync(sentryCommand, args, {
      cwd: repoRoot,
      env: childEnv,
      stdio: 'inherit',
    });
  if (result.status !== 0) {
    if (allowFailure) {
      console.warn(`sentry-cli ${args.join(' ')} failed; continuing without it.`);
      return;
    }
    process.exit(result.status || 1);
  }
};

run(['releases', 'new', release]);
// Best-effort: shallow CI clones may not have the history needed for --auto.
run(['releases', 'set-commits', release, '--auto'], { allowFailure: true });

if (existsSync(appDist)) {
  run(['sourcemaps', 'upload', appDist, '--url-prefix', '~/assets', '--validate']);
} else {
  console.warn('app/dist does not exist; skipping sourcemap upload.');
}

run(['releases', 'finalize', release]);
console.log(`Sentry release finalized: ${release}`);
