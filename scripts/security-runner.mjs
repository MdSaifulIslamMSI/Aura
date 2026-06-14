import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const reportsDir = path.join(repoRoot, 'security-reports');
mkdirSync(reportsDir, { recursive: true });

if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
  throw new Error('Refusing to run security suite with NODE_ENV=production');
}

const categories = [
  { name: 'harness', args: ['run', 'security:harness'] },
  { name: 'idor', args: ['run', 'security:idor'] },
  { name: 'tokens', args: ['run', 'security:tokens'] },
  { name: 'auth', args: ['run', 'security:auth'] },
  { name: 'admin', args: ['run', 'security:admin'] },
  { name: 'webhooks', args: ['run', 'security:webhooks'] },
  { name: 'business-logic', args: ['run', 'security:business-logic'] },
  { name: 'otp-reset', args: ['run', 'security:otp-reset'] },
  { name: 'rate-limit', args: ['run', 'security:rate-limit'] },
  { name: 'cors-csrf', args: ['run', 'security:cors-csrf'] },
  { name: 'headers', args: ['run', 'security:headers'] },
  { name: 'cloudflare', args: ['run', 'security:cloudflare'] },
  { name: 'duo', args: ['run', 'security:duo'] },
  { name: 'logging', args: ['run', 'security:logging'] },
  { name: 'edge-assets', args: ['run', 'security:edge-assets'] },
  { name: 'uploads', args: ['run', 'security:uploads'] },
  { name: 'malware-runtime', args: ['run', 'security:malware-runtime'] },
  { name: 'free-scanners', args: ['run', 'security:free-scanners'] },
  { name: 'secrets', args: ['run', 'security:secrets'] },
  { name: 'deps', args: ['run', 'security:deps'] },
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

  return {
    command: process.execPath,
    argsPrefix: [npmCli],
    display: 'npm',
  };
};

const npmInvocation = resolveNpmInvocation();

const parseJestTestCount = (output = '') => {
  const matches = [...String(output || '').matchAll(/Tests:\s+(?:(\d+)\s+failed,\s+)?(?:(\d+)\s+skipped,\s+)?(?:(\d+)\s+passed,\s+)?(\d+)\s+total/g)];
  return matches.reduce((sum, match) => sum + Number(match[4] || 0), 0);
};

const results = [];
let totalTests = 0;

for (const { name, args } of categories) {
  const command = `${npmInvocation.display} ${args.join(' ')}`;
  const startedAt = Date.now();
  console.log(`\n[security] ${name}: ${command}`);
  const result = spawnSync(npmInvocation.command, [...npmInvocation.argsPrefix, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV && process.env.NODE_ENV !== 'production' ? process.env.NODE_ENV : 'test',
    },
  });

  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) {
    console.error(`[security] ${name}: ${result.error.message}`);
  }

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

const reportRun = spawnSync(npmInvocation.command, [...npmInvocation.argsPrefix, 'run', 'security:report'], {
  cwd: repoRoot,
  encoding: 'utf8',
});
process.stdout.write(reportRun.stdout || '');
process.stderr.write(reportRun.stderr || '');

const failed = results.filter((result) => result.status !== 'passed');
if (failed.length > 0) {
  console.error(`[security] ${failed.length} category/categories failed.`);
  process.exit(1);
}

console.log('[security] all categories passed.');
