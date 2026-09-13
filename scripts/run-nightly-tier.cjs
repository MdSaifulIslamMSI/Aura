#!/usr/bin/env node
'use strict';

/**
 * Nightly tier runner with one-shot flake retry.
 *
 * Runs a tier (or one shard of it), re-runs failed suites once with
 * --runInBand, and writes a JSON report distinguishing flakes (failed then
 * passed) from real failures. Exit code reflects the post-retry state so the
 * scheduled workflow can fail loudly on real breakage while the report keeps
 * the flake signal visible.
 *
 * Usage:
 *   node scripts/run-nightly-tier.cjs <surface> <tier> [--shard=i/n] [--report=<path>] [extra jest args...]
 *
 * Report default: reports/nightly/<surface>-<tier>[-shard<i>of<n>].json
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveTier, shardFiles, parseShardArg, buildNightlyReport } = require('./lib/test-tier-lib.cjs');

const fail = (message) => {
    console.error(`[run-nightly-tier] ${message}`);
    process.exit(1);
};

const [surface, tier, ...extraArgs] = process.argv.slice(2);
if (!surface || !tier) {
    fail('Usage: node scripts/run-nightly-tier.cjs <surface> <tier> [--shard=i/n] [--report=<path>] [extra jest args...]');
}

const { shardArgs, shard } = parseShardArg(extraArgs);
const reportArg = shardArgs.find((arg) => arg.startsWith('--report='));
const reportPath = reportArg
    ? path.resolve(reportArg.slice('--report='.length))
    : path.join('reports', 'nightly', `${surface}-${tier}${shard ? `-shard${shard.index}of${shard.count}` : ''}.json`);
const jestExtraArgs = shardArgs.filter((arg) => arg !== reportArg);

let tierFiles;
let serverDir;
try {
    ({ files: tierFiles, serverDir } = resolveTier(surface, tier));
} catch (error) {
    fail(error.message);
}

const shardLabel = shard ? ` (shard ${shard.index}/${shard.count})` : '';
let testFiles = tierFiles;
if (shard) {
    try {
        testFiles = shardFiles(tierFiles, shard.index, shard.count);
    } catch (error) {
        fail(error.message);
    }
}

console.log(`[run-nightly-tier] ${surface}/${tier}${shardLabel}: ${testFiles.length} suites`);

const toRelative = (absolutePath) => path.relative(serverDir, absolutePath).split(path.sep).join('/');

const runJest = (files, runInBand) => {
    const jestBin = path.join(serverDir, 'node_modules', 'jest', 'bin', 'jest.js');
    if (!fs.existsSync(jestBin)) {
        fail(`Jest binary not found at ${jestBin}. Run npm install in ${serverDir}.`);
    }
    const outputFile = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'aura-nightly-')), 'jest-result.json');
    const args = [
        jestBin,
        '--runTestsByPath',
        ...files,
        '--json',
        `--outputFile=${outputFile}`,
        '--forceExit',
        ...(runInBand ? ['--runInBand'] : []),
        ...jestExtraArgs,
    ];
    const result = spawnSync(process.execPath, args, {
        stdio: ['ignore', 'inherit', 'inherit'],
        cwd: serverDir,
        env: { ...process.env, NODE_ENV: 'test' },
    });
    if (result.error) {
        fail(`Failed to spawn jest: ${result.error.message}`);
    }
    if (!fs.existsSync(outputFile)) {
        return { output: null, failedSuites: files.slice() };
    }
    let output;
    try {
        output = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    } catch (error) {
        fail(`Jest result JSON unreadable: ${error.message}`);
    }
    const failedSuites = (output.testResults || [])
        .filter((suite) => suite.status && suite.status !== 'passed')
        .map((suite) => toRelative(suite.name));
    return { output, failedSuites, exitStatus: result.status };
};

if (testFiles.length === 0) {
    // Empty tiers (e.g. quarantine) are legitimately no-ops.
    const emptyReport = buildNightlyReport({
        surface,
        tier,
        shard: shard || null,
        firstRun: { totalSuites: 0, failedSuites: [] },
        retry: null,
    });
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(emptyReport, null, 2)}\n`);
    console.log(`[run-nightly-tier] no suites in tier; report: ${reportPath}`);
    process.exit(0);
}

const firstRun = runJest(testFiles, false);
console.log(`[run-nightly-tier] first run: ${firstRun.failedSuites.length} failed suite(s)`);

let retry = null;
if (firstRun.failedSuites.length > 0) {
    console.log(`[run-nightly-tier] retrying failed suites once with --runInBand: ${firstRun.failedSuites.join(', ')}`);
    retry = runJest(firstRun.failedSuites, true);
    console.log(`[run-nightly-tier] retry: ${retry.failedSuites.length} still failing`);
}

const report = buildNightlyReport({
    surface,
    tier,
    shard: shard || null,
    firstRun: { totalSuites: testFiles.length, failedSuites: firstRun.failedSuites },
    retry,
});

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (report.flakes.length > 0) {
    console.log(`[run-nightly-tier] FLAKY (${report.flakes.length}): ${report.flakes.join(', ')}`);
}
if (report.failed.length > 0) {
    console.error(`[run-nightly-tier] FAILED (${report.failed.length}): ${report.failed.join(', ')}`);
    console.error(`[run-nightly-tier] report: ${reportPath}`);
    process.exit(1);
}
console.log(`[run-nightly-tier] all suites passed after retry; report: ${reportPath}`);
