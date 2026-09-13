import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { resolveTier, shardFiles, parseShardArg, buildNightlyReport } = require('./lib/test-tier-lib.cjs');

const scriptPath = fileURLToPath(new URL('./run-nightly-tier.cjs', import.meta.url));
const runnerPath = fileURLToPath(new URL('./run-test-tier.cjs', import.meta.url));

test('resolveTier resolves the real manifest tiers without stale entries', () => {
  const regression = resolveTier('server', 'regression');
  assert.ok(regression.files.length > 0, 'regression tier must not be empty');
  for (const file of regression.files) {
    assert.match(file, /^tests\//, `regression entry outside tests/: ${file}`);
  }

  const nightly = resolveTier('server', 'nightly');
  assert.ok(nightly.files.length > 0, 'nightly tier must not be empty');

  const quarantine = resolveTier('server', 'quarantine');
  assert.deepEqual(quarantine.files, [], 'quarantine tier starts empty');
});

test('resolveTier throws on unknown tier and unknown surface', () => {
  assert.throws(() => resolveTier('server', 'does-not-exist'), /Tier "does-not-exist"/);
  assert.throws(() => resolveTier('not-a-surface', 'regression'), /Unknown surface "not-a-surface"/);
});

test('shardFiles partitions the tier deterministically with no overlap', () => {
  const { files } = resolveTier('server', 'nightly');
  const shards = [];
  for (let index = 1; index <= 6; index += 1) {
    shards.push(shardFiles(files, index, 6));
  }

  const union = shards.flat().sort();
  assert.equal(union.length, files.length, 'union of shards must cover the whole tier');
  assert.deepEqual(union, files.slice().sort(), 'union must equal the tier list exactly');

  for (const shard of shards) {
    assert.equal(new Set(shard).size, shard.length, 'shard must not repeat a suite');
  }

  // Round-robin balance: shard sizes differ by at most one.
  const sizes = shards.map((shard) => shard.length);
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `unbalanced shards: ${sizes.join(',')}`);

  // Determinism: same inputs, same slice.
  assert.deepEqual(shardFiles(files, 3, 6), shards[2]);
});

test('shardFiles rejects out-of-range shard requests', () => {
  assert.throws(() => shardFiles(['a'], 0, 1), /Invalid shard/);
  assert.throws(() => shardFiles(['a'], 2, 1), /Invalid shard/);
  assert.throws(() => shardFiles(['a'], 1, 0), /Invalid shard/);
});

test('parseShardArg extracts --shard=i/n and preserves other args', () => {
  const { shardArgs, shard } = parseShardArg(['--forceExit', '--shard=2/6', '--runInBand']);
  assert.deepEqual(shardArgs, ['--forceExit', '--runInBand']);
  assert.deepEqual(shard, { index: 2, count: 6 });

  const noShard = parseShardArg(['--forceExit']);
  assert.deepEqual(noShard.shardArgs, ['--forceExit']);
  assert.equal(noShard.shard, null);
});

test('buildNightlyReport classifies flakes versus real failures', () => {
  const base = { surface: 'server', tier: 'nightly', shard: { index: 1, count: 6 } };

  const flakyThenGreen = buildNightlyReport({
    ...base,
    firstRun: { totalSuites: 4, failedSuites: ['tests/a.test.js', 'tests/b.test.js'] },
    retry: { failedSuites: ['tests/b.test.js'] },
  });
  assert.deepEqual(flakyThenGreen.flakes, ['tests/a.test.js']);
  assert.deepEqual(flakyThenGreen.failed, ['tests/b.test.js']);
  assert.equal(flakyThenGreen.passedAfterRetry, false);
  assert.equal(flakyThenGreen.stillFailingCount, 1);

  const cleanFirstRun = buildNightlyReport({
    ...base,
    firstRun: { totalSuites: 4, failedSuites: [] },
    retry: null,
  });
  assert.deepEqual(cleanFirstRun.flakes, []);
  assert.deepEqual(cleanFirstRun.failed, []);
  assert.equal(cleanFirstRun.passedAfterRetry, true);

  const crashedRetry = buildNightlyReport({
    ...base,
    firstRun: { totalSuites: 2, failedSuites: ['tests/a.test.js'] },
    retry: { failedSuites: ['tests/a.test.js'] },
  });
  assert.deepEqual(crashedRetry.failed, ['tests/a.test.js']);
  assert.deepEqual(crashedRetry.flakes, []);
});

test('run-nightly-tier no-ops cleanly on the empty quarantine tier', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'aura-nightly-test-'));
  try {
    const report = path.join(tmp, 'quarantine-report.json');
    const result = spawnSync(process.execPath, [
      scriptPath,
      'server',
      'quarantine',
      `--report=${report}`,
    ], { encoding: 'utf8', timeout: 30_000 });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /no suites in tier/);
    assert.ok(existsSync(report), 'empty-tier report must still be written');
    const parsed = JSON.parse(readFileSync(report, 'utf8'));
    assert.equal(parsed.tier, 'quarantine');
    assert.equal(parsed.firstRun.totalSuites, 0);
    assert.equal(parsed.passedAfterRetry, true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('run-test-tier --shard slices resolve through the shared lib (dry run)', () => {
  const result = spawnSync(process.execPath, [
    runnerPath,
    'server',
    'nightly',
    '--shard=5/6',
    '--dry-run',
  ], { encoding: 'utf8', timeout: 30_000 });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const { files } = resolveTier('server', 'nightly');
  const expected = shardFiles(files, 5, 6).length;
  assert.match(result.stdout, new RegExp(`dry-run \\(${expected} files \\(shard 5/6\\)\\)`));
  assert.doesNotMatch(result.stdout, /--shard=5\/6/, 'jest must never receive the --shard flag');
});
