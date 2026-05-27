import { runCommand } from './command.mjs';

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
  console.warn(`Lighthouse target not reachable (${baseUrl}); skipping optional Lighthouse run.`);
  process.exit(0);
}

const result = runCommand('npx', ['--yes', '@lhci/cli', 'autorun', '--config=./lighthouserc.js'], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
