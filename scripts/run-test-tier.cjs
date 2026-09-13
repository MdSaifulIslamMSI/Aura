#!/usr/bin/env node
'use strict';

/**
 * Run a test tier from config/test-tiers.json — the single source of truth
 * for test file lists. Replaces hand-maintained --runTestsByPath lists that
 * drifted between package.json and CI workflows.
 *
 * Usage:
 *   node scripts/run-test-tier.mjs <surface> <tier> [extra jest args...]
 *   node scripts/run-test-tier.mjs server regression --forceExit
 *   node scripts/run-test-tier.mjs server regression --runInBand   (CI)
 *   node scripts/run-test-tier.mjs server regression --dry-run     (print resolved command)
 *   node scripts/run-test-tier.mjs server nightly --shard=2/6 --forceExit
 *
 * Fails fast with a clear message if the manifest, tier, or any listed file
 * is missing — stale entries can never silently skip tests.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveTier, shardFiles, parseShardArg } = require('./lib/test-tier-lib.cjs');

const fail = (message) => {
    console.error(`[run-test-tier] ${message}`);
    process.exit(1);
};

const [surface, tier, ...extraArgs] = process.argv.slice(2);
if (!surface || !tier) {
    fail('Usage: node scripts/run-test-tier.mjs <surface> <tier> [extra jest args...]');
}

let tierFiles;
let serverDir;
try {
    ({ files: tierFiles, serverDir } = resolveTier(surface, tier));
} catch (error) {
    fail(error.message);
}
if (tierFiles.length === 0) {
    fail(`Tier "${tier}" is empty for surface "${surface}".`);
}

const { shardArgs, shard } = parseShardArg(extraArgs);
let testFiles = tierFiles;
let shardLabel = '';
if (shard) {
    try {
        testFiles = shardFiles(tierFiles, shard.index, shard.count);
    } catch (error) {
        fail(error.message);
    }
    shardLabel = ` (shard ${shard.index}/${shard.count})`;
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const jestArgs = ['--runTestsByPath', ...testFiles, ...shardArgs];
const cmd = `${npmCmd} --prefix "${serverDir}" test -- ${jestArgs.join(' ')}`;

if (shardArgs.includes('--dry-run')) {
    console.log(`[run-test-tier] dry-run (${testFiles.length} files${shardLabel}):\n  ${cmd}`);
    process.exit(0);
}

console.log(`[run-test-tier] ${surface}/${tier}${shardLabel}: ${testFiles.length} suites`);

// Spawn the jest binary directly (replicating the server package's
// `cross-env NODE_ENV=test jest` script) — npm.cmd cannot be spawned
// without a shell on modern Node.
const jestBin = path.join(serverDir, 'node_modules', 'jest', 'bin', 'jest.js');
if (!fs.existsSync(jestBin)) {
    fail(`Jest binary not found at ${jestBin}. Run npm install in ${serverDir}.`);
}

const result = spawnSync(process.execPath, [jestBin, ...jestArgs], {
    stdio: 'inherit',
    cwd: serverDir,
    env: { ...process.env, NODE_ENV: 'test' },
});

if (result.error) {
    fail(`Failed to spawn jest: ${result.error.message}`);
}
process.exit(result.status ?? 1);
