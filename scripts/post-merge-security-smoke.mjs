import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const reportsDir = path.join(repoRoot, 'security-reports');
mkdirSync(reportsDir, { recursive: true });

if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
  throw new Error('Refusing to run post-merge security smoke with NODE_ENV=production');
}

const commands = [
  ['observability', 'npm run observability:validate'],
  ['malware-runtime', 'npm run security:malware-runtime'],
  ['edge-assets', 'npm run security:edge-assets'],
  ['free-scanners', 'npm run security:free-scanners'],
  ['harness', 'npm run security:harness'],
  ['deps', 'npm run security:deps'],
  ['secrets', 'npm run security:secrets'],
];

const shouldRunStagingSmoke = Boolean(String(process.env.SMOKE_BASE_URL || '').trim());
if (shouldRunStagingSmoke) {
  commands.push(['staging-smoke', 'npm --prefix server run smoke:staging']);
}

const results = [];

for (const [name, command] of commands) {
  console.log(`\n[post-merge-smoke] ${name}: ${command}`);
  const startedAt = Date.now();
  const result = spawnSync(command, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: true,
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV && process.env.NODE_ENV !== 'production' ? process.env.NODE_ENV : 'test',
    },
  });

  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');

  results.push({
    name,
    command,
    status: result.status === 0 ? 'passed' : 'failed',
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
  });
}

if (!shouldRunStagingSmoke) {
  results.push({
    name: 'staging-smoke',
    command: 'npm --prefix server run smoke:staging',
    status: 'skipped',
    exitCode: 0,
    reason: 'SMOKE_BASE_URL is not set; live staging smoke was not run.',
  });
  console.log('\n[post-merge-smoke] staging-smoke: skipped');
  console.log('[post-merge-smoke] staging-smoke: SMOKE_BASE_URL is not set; live staging smoke was not run.');
}

const report = {
  generatedAt: new Date().toISOString(),
  results,
};

writeFileSync(path.join(reportsDir, 'post-merge-security-smoke.json'), `${JSON.stringify(report, null, 2)}\n`);

const failed = results.filter((result) => result.status === 'failed');
if (failed.length > 0) {
  console.error(`[post-merge-smoke] ${failed.length} check(s) failed. See security-reports/post-merge-security-smoke.json`);
  process.exit(1);
}

console.log('[post-merge-smoke] post-merge security smoke checks passed.');
