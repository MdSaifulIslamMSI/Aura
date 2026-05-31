import { spawnSync } from 'node:child_process';

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error('[quality:all] Run this wrapper through npm run quality:all.');
  process.exit(1);
}

const commands = [
  'quality:lint',
  'quality:typecheck',
  'quality:coverage',
  'quality:deadcode',
  'quality:secrets',
  'quality:deps',
  'quality:semgrep',
  'quality:trivy',
  'quality:osv',
  'quality:dockerfile',
  'quality:shell',
  'quality:actions',
  'quality:sonar',
];

for (const script of commands) {
  console.log(`\n[quality:all] npm run ${script}`);
  const result = spawnSync(process.execPath, [npmCli, 'run', script], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log('\n[quality:all] all configured checks passed or were explicitly skipped by local-only availability policy.');
