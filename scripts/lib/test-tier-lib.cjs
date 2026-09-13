'use strict';

/**
 * Shared helpers for tier-based test runners (run-test-tier.cjs and
 * run-nightly-tier.cjs). The manifest at config/test-tiers.json stays the
 * single source of truth — no runner may hardcode test file lists.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MANIFEST_PATH = path.join(ROOT, 'config', 'test-tiers.json');

/**
 * Resolve a surface/tier into absolute-checked test file paths.
 * Throws on missing manifest, unknown surface/tier, or stale entries so a
 * drift can never silently skip suites.
 */
function resolveTier(surface, tier) {
    if (!fs.existsSync(MANIFEST_PATH)) {
        throw new Error(`Manifest not found: ${MANIFEST_PATH}`);
    }
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    } catch (error) {
        throw new Error(`Manifest is not valid JSON: ${error.message}`);
    }
    const surfaceConfig = manifest[surface];
    if (!surfaceConfig) {
        const known = Object.keys(manifest).filter((k) => !k.startsWith('$')).join(', ');
        throw new Error(`Unknown surface "${surface}". Available: ${known}`);
    }
    const files = surfaceConfig[tier];
    if (!Array.isArray(files)) {
        throw new Error(`Tier "${tier}" missing or not an array for surface "${surface}".`);
    }
    const serverDir = path.join(ROOT, surface);
    const missing = files.filter((f) => !fs.existsSync(path.join(serverDir, f)));
    if (missing.length > 0) {
        throw new Error(`Stale manifest entries (files no longer exist):\n  ${missing.join('\n  ')}\nUpdate config/test-tiers.json.`);
    }
    return { files, serverDir };
}

/**
 * Deterministic round-robin shard: shard i (1-based) of n gets every file
 * whose index % n === i-1. Round-robin spreads alphabetically-clustered
 * heavy suites (auth*, payment*) across shards instead of stacking them.
 * Every file lands in exactly one shard; union of shards == input list.
 */
function shardFiles(files, shardIndex, shardCount) {
    if (!Number.isInteger(shardIndex) || !Number.isInteger(shardCount) || shardIndex < 1 || shardCount < 1 || shardIndex > shardCount) {
        throw new Error(`Invalid shard ${shardIndex}/${shardCount}.`);
    }
    return files.filter((_, index) => index % shardCount === shardIndex - 1);
}

/**
 * Parse a --shard=i/n flag out of extra args. Returns {shardArgs, shard} where
 * shard is null when the flag is absent (so jest never sees --shard, which it
 * does not understand as we use it).
 */
function parseShardArg(extraArgs) {
    const shardArgs = [];
    let shard = null;
    for (const arg of extraArgs) {
        const match = /^--shard=(\d+)\/(\d+)$/.exec(arg);
        if (match) {
            shard = { index: Number.parseInt(match[1], 10), count: Number.parseInt(match[2], 10) };
        } else {
            shardArgs.push(arg);
        }
    }
    return { shardArgs, shard };
}

/**
 * Merge first-run jest JSON and optional retry jest JSON into the nightly
 * report shape. Pure so the aggregation stays fixture-testable.
 *
 * firstRun: { output: parsed jest JSON | null, failedSuites: string[] }
 * retry:    { output: parsed jest JSON | null, failedSuites: string[] } | null
 */
function buildNightlyReport({ surface, tier, shard, firstRun, retry }) {
    const flakes = [];
    const failed = [];
    const stillFailing = retry ? retry.failedSuites : firstRun.failedSuites;
    for (const suite of firstRun.failedSuites) {
        if (retry && !retry.failedSuites.includes(suite)) flakes.push(suite);
        else failed.push(suite);
    }
    return {
        surface,
        tier,
        shard: shard || null,
        firstRun: {
            totalSuites: firstRun.totalSuites,
            failedSuites: firstRun.failedSuites,
        },
        retriedSuites: firstRun.failedSuites,
        flakes,
        failed,
        stillFailingCount: stillFailing.length,
        passedAfterRetry: failed.length === 0,
    };
}

module.exports = { MANIFEST_PATH, resolveTier, shardFiles, parseShardArg, buildNightlyReport };
