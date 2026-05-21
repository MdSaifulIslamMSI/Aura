import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const reportsDir = path.join(repoRoot, 'security-reports');
mkdirSync(reportsDir, { recursive: true });

if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
  throw new Error('Refusing to run security suite with NODE_ENV=production');
}

const categories = [
  ['harness', 'npm run security:harness'],
  ['idor', 'npm run security:idor'],
  ['tokens', 'npm run security:tokens'],
  ['auth', 'npm run security:auth'],
  ['admin', 'npm run security:admin'],
  ['webhooks', 'npm run security:webhooks'],
  ['business-logic', 'npm run security:business-logic'],
  ['otp-reset', 'npm run security:otp-reset'],
  ['rate-limit', 'npm run security:rate-limit'],
  ['cors-csrf', 'npm run security:cors-csrf'],
  ['headers', 'npm run security:headers'],
  ['cloudflare', 'npm run security:cloudflare'],
  ['duo', 'npm run security:duo'],
  ['logging', 'npm run security:logging'],
  ['secrets', 'npm run security:secrets'],
  ['deps', 'npm run security:deps'],
];

const parseJestTestCount = (output = '') => {
  const matches = [...String(output || '').matchAll(/Tests:\s+(?:(\d+)\s+failed,\s+)?(?:(\d+)\s+skipped,\s+)?(?:(\d+)\s+passed,\s+)?(\d+)\s+total/g)];
  return matches.reduce((sum, match) => sum + Number(match[4] || 0), 0);
};

const results = [];
let totalTests = 0;

for (const [name, command] of categories) {
  const startedAt = Date.now();
  console.log(`\n[security] ${name}: ${command}`);
  const result = spawnSync(command, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: true,
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV && process.env.NODE_ENV !== 'production' ? process.env.NODE_ENV : 'test',
    },
  });

  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');

  const testCount = parseJestTestCount(output);
  totalTests += testCount;
  results.push({
    name,
    command,
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
    parsedTestCount: testCount,
  });
}

const report = {
  generatedAt: new Date().toISOString(),
  totalTests,
  categories: results,
};

writeFileSync(path.join(reportsDir, 'security-results.json'), `${JSON.stringify(report, null, 2)}\n`);

const reportRun = spawnSync('npm run security:report', {
  cwd: repoRoot,
  encoding: 'utf8',
  shell: true,
});
process.stdout.write(reportRun.stdout || '');
process.stderr.write(reportRun.stderr || '');

const failed = results.filter((result) => result.status !== 'passed');
if (failed.length > 0) {
  console.error(`[security] ${failed.length} category/categories failed.`);
  process.exit(1);
}

console.log('[security] all categories passed.');
