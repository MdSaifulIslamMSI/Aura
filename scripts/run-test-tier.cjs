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
 *
 * Fails fast with a clear message if the manifest, tier, or any listed file
 * is missing — stale entries can never silently skip tests.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'config', 'test-tiers.json');

const fail = (message) => {
    console.error(`[run-test-tier] ${message}`);
    process.exit(1);
};

const [surface, tier, ...extraArgs] = process.argv.slice(2);
if (!surface || !tier) {
    fail('Usage: node scripts/run-test-tier.mjs <surface> <tier> [extra jest args...]');
}

if (!fs.existsSync(MANIFEST_PATH)) {
    fail(`Manifest not found: ${MANIFEST_PATH}`);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const surfaceConfig = manifest[surface];
if (!surfaceConfig) {
    fail(`Unknown surface "${surface}" in manifest. Available: ${Object.keys(manifest).filter((k) => !k.startsWith('$')).join(', ')}`);
}

const testFiles = surfaceConfig[tier];
if (!Array.isArray(testFiles) || testFiles.length === 0) {
    fail(`Tier "${tier}" missing or empty for surface "${surface}".`);
}

const serverDir = path.join(ROOT, surface);
const missing = testFiles.filter((f) => !fs.existsSync(path.join(serverDir, f)));
if (missing.length > 0) {
    fail(`Stale manifest entries (files no longer exist):\n  ${missing.join('\n  ')}\nUpdate config/test-tiers.json.`);
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const jestArgs = ['--runTestsByPath', ...testFiles, ...extraArgs];
const cmd = `${npmCmd} --prefix "${serverDir}" test -- ${jestArgs.join(' ')}`;

if (extraArgs.includes('--dry-run')) {
    console.log(`[run-test-tier] dry-run (${testFiles.length} files):\n  ${cmd}`);
    process.exit(0);
}

console.log(`[run-test-tier] ${surface}/${tier}: ${testFiles.length} suites`);

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
