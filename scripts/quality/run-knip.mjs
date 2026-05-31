import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const reportDir = path.join(repoRoot, 'reports', 'quality');
const reportPath = path.join(reportDir, 'knip.txt');
const strict = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.QUALITY_DEADCODE_STRICT || '').trim().toLowerCase()
);
const knipPath = path.join(repoRoot, 'node_modules', 'knip', 'bin', 'knip.js');

mkdirSync(reportDir, { recursive: true });

if (!existsSync(knipPath)) {
  console.error('[quality:deadcode] Knip is missing. Run npm install.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--max-old-space-size=4096', knipPath, '--config', 'knip.json', '--reporter', 'compact'], {
  cwd: repoRoot,
  encoding: 'utf8',
  shell: false,
});
const output = `${result.stdout || ''}${result.stderr || ''}`;

writeFileSync(reportPath, output || '[quality:deadcode] no findings\n');
process.stdout.write(output);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0 && !strict) {
  console.log(`[quality:deadcode] legacy findings recorded at ${path.relative(repoRoot, reportPath)}.`);
  console.log('[quality:deadcode] report mode is intentional until the baseline is triaged.');
  process.exit(0);
}

process.exit(result.status || 0);
