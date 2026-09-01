import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scannerPath = fileURLToPath(new URL('./security-secret-scan.mjs', import.meta.url));

const run = (command, args, options = {}) => spawnSync(command, args, {
  encoding: 'utf8',
  shell: false,
  timeout: 30_000,
  ...options,
});

const runGit = (repoRoot, args) => {
  const result = run('git', args, { cwd: repoRoot });
  assert.equal(result.status, 0, result.stderr || result.stdout);
};

const createRepo = (t) => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'aura-secret-scan-test-'));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  runGit(repoRoot, ['init', '--quiet']);
  return repoRoot;
};

const stagePlaceholderFiles = (repoRoot, files) => {
  for (const file of files) {
    const absolutePath = path.join(repoRoot, file);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, 'PLACEHOLDER_ONLY=true\n');
  }
  runGit(repoRoot, ['add', '--force', '--', ...files]);
};

const runScanner = (repoRoot) => run(process.execPath, [scannerPath], {
  cwd: repoRoot,
  env: {
    ...process.env,
    NODE_ENV: 'test',
  },
});

test('secret scan rejects every tracked env-file variant', (t) => {
  const repoRoot = createRepo(t);
  const forbiddenFiles = ['.env.development', '.env.production.local', 'app/.env.test'];
  stagePlaceholderFiles(repoRoot, forbiddenFiles);

  const result = runScanner(repoRoot);
  assert.notEqual(result.status, 0, 'expected the secret scan to reject tracked env files');

  const report = JSON.parse(readFileSync(path.join(repoRoot, 'security-reports', 'secret-scan.json'), 'utf8'));
  const reportedFiles = report.findings
    .filter((finding) => finding.rule === 'committed-env-file')
    .map((finding) => finding.file)
    .sort();

  assert.deepEqual(reportedFiles, forbiddenFiles.sort());
});

test('secret scan permits tracked env example templates', (t) => {
  const repoRoot = createRepo(t);
  const exampleFiles = ['.env.example', '.env.production.example'];
  stagePlaceholderFiles(repoRoot, exampleFiles);

  const result = runScanner(repoRoot);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const report = JSON.parse(readFileSync(path.join(repoRoot, 'security-reports', 'secret-scan.json'), 'utf8'));
  assert.equal(report.findings.some((finding) => finding.rule === 'committed-env-file'), false);
});
