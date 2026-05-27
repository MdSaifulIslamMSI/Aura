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

const baseUrl = String(process.env.PERF_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 2500);

let reachable = false;
try {
  const response = await fetch(baseUrl, { signal: controller.signal });
  reachable = response.status < 500;
} catch {
  reachable = false;
} finally {
  clearTimeout(timeout);
}

if (!reachable) {
  console.warn(`k6 target not reachable (${baseUrl}); skipping optional k6 ${mode} run.`);
  process.exit(0);
}

fs.mkdirSync('.run-logs', { recursive: true });

const result = runCommand('k6', ['run', '--summary-export', `.run-logs/k6-${mode}.json`, script], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
