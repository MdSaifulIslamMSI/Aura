import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const reportsDir = path.join(repoRoot, 'security-reports');
mkdirSync(reportsDir, { recursive: true });

if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
  throw new Error('Refusing to run post-merge security smoke with NODE_ENV=production');
}

const commands = [
  { name: 'environment-contract', args: ['run', 'env:validate'] },
  { name: 'smoke-preflight', args: ['run', 'smoke:preflight'] },
  { name: 'prod-fallback-scan', args: ['run', 'scan:prod-fallbacks'] },
  { name: 'observability', args: ['run', 'observability:validate'] },
  { name: 'malware-runtime', args: ['run', 'security:malware-runtime'] },
  { name: 'edge-assets', args: ['run', 'security:edge-assets'] },
  { name: 'free-scanners', args: ['run', 'security:free-scanners'] },
  { name: 'harness', args: ['run', 'security:harness'] },
  { name: 'deps', args: ['run', 'security:deps'] },
  { name: 'secrets', args: ['run', 'security:secrets'] },
];

const resolveNpmInvocation = () => {
  if (process.platform !== 'win32') {
    return { command: 'npm', argsPrefix: [], display: 'npm' };
  }

  const bundledNpmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const npmCli = [process.env.npm_execpath, bundledNpmCli]
    .filter(Boolean)
    .find((candidate) => existsSync(candidate));

  if (!npmCli) {
    throw new Error('Unable to locate npm-cli.js for shell-free npm execution on Windows');
  }

  return { command: process.execPath, argsPrefix: [npmCli], display: 'npm' };
};

const npmInvocation = resolveNpmInvocation();

const shouldRunStagingSmoke = Boolean(String(process.env.SMOKE_BASE_URL || '').trim());
if (shouldRunStagingSmoke) {
  commands.push({ name: 'staging-smoke', args: ['--prefix', 'server', 'run', 'smoke:staging'] });
}

const results = [];

for (const { name, args } of commands) {
  const command = `${npmInvocation.display} ${args.join(' ')}`;
  console.log(`\n[post-merge-smoke] ${name}: ${command}`);
  const startedAt = Date.now();
  const result = spawnSync(npmInvocation.command, [...npmInvocation.argsPrefix, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV && process.env.NODE_ENV !== 'production' ? process.env.NODE_ENV : 'test',
    },
  });

  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) {
    console.error(`[post-merge-smoke] ${name}: ${result.error.message}`);
  }

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
