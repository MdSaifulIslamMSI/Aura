import fs from 'node:fs';
import { runCommand } from './command.mjs';

const mode = process.argv[2] || 'smoke';
const scriptByMode = {
  smoke: 'tests/performance/k6/smoke.js',
  load: 'tests/performance/k6/smoke.js',
  stress: 'tests/performance/k6/stress.js',
  spike: 'tests/performance/k6/spike.js',
};

const script = scriptByMode[mode];
if (!script) {
  console.error(`Unknown k6 mode: ${mode}`);
  process.exit(1);
}

const version = runCommand('k6', ['version'], { stdio: 'pipe' });
if (version.status !== 0) {
  console.warn('k6 is not installed; skipping optional k6 performance run.');
  process.exit(0);
}

fs.mkdirSync('.run-logs', { recursive: true });

const result = runCommand('k6', ['run', '--summary-export', `.run-logs/k6-${mode}.json`, script], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
