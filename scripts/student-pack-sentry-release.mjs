#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStudentPackEnv } from './lib/student-pack-env.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
loadStudentPackEnv();
const appDist = join(repoRoot, 'app', 'dist');
const release = process.env.SENTRY_RELEASE
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

const run = (args) => {
  const result = spawnSync(sentryCommand, args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
};

run(['releases', 'new', release]);
run(['releases', 'set-commits', release, '--auto']);

if (existsSync(appDist)) {
  run(['sourcemaps', 'upload', appDist, '--release', release, '--url-prefix', '~/assets', '--validate']);
} else {
  console.warn('app/dist does not exist; skipping sourcemap upload.');
}

run(['releases', 'finalize', release]);
console.log(`Sentry release finalized: ${release}`);
