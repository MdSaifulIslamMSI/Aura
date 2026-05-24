#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStudentPackEnv } from './lib/student-pack-env.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
loadStudentPackEnv();
const command = process.argv[2] || 'doctor';
const datadogEnvReady = Boolean(process.env.DATADOG_API_KEY || process.env.DD_API_KEY);
const datadogCommand = process.platform === 'win32' ? 'datadog-ci.cmd' : 'datadog-ci';

const run = (args, options = {}) => spawnSync(datadogCommand, args, {
  cwd: repoRoot,
  stdio: options.stdio || 'inherit',
  encoding: options.encoding,
});

if (command === 'doctor') {
  const version = run(['version'], { stdio: 'pipe', encoding: 'utf8' });
  if (version.status !== 0) {
    console.error(version.stderr || version.stdout || 'datadog-ci is not runnable.');
    process.exit(version.status || 1);
  }
  console.log(version.stdout.trim());
  console.log(datadogEnvReady ? 'Datadog API key env is present.' : 'Datadog API key env is missing.');
  process.exit(datadogEnvReady ? 0 : 1);
}

if (command === 'junit') {
  if (!datadogEnvReady) {
    console.error('DATADOG_API_KEY or DD_API_KEY is required for junit upload.');
    process.exit(1);
  }
  const junitPath = process.argv[3] || join(repoRoot, 'test-results');
  if (!existsSync(junitPath)) {
    console.error(`JUnit path does not exist: ${junitPath}`);
    process.exit(1);
  }
  const result = run(['junit', 'upload', junitPath, '--service', 'aura-marketplace']);
  process.exit(result.status || 0);
}

console.error(`Unknown Datadog command: ${command}`);
process.exit(1);
