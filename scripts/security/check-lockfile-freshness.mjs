#!/usr/bin/env node
// Release-cooldown gate: no lockfile entry may point at a version published
// more recently than the cooldown window, unless explicitly allowlisted.
//
// Rationale: poisoned npm releases (the 2025-2026 worm waves) are typically
// yanked from the registry within days of publication. This repo's Dependabot
// policy automerges patch/minor/major bumps, so a same-day malicious release
// could otherwise flow from registry to production lockfile without a human
// in the loop. Requiring an age floor on NEW lockfile versions gives the
// community time to flag a poisoned release before it reaches CI.
//
// Scope: only lockfile versions that CHANGED relative to a base revision are
// checked — the gate costs one registry lookup per changed package, not per
// tree. Base resolution order:
//   1. $GITHUB_BASE_REF (pull_request events: merge-base with origin/<ref>)
//   2. $GITHUB_EVENT_BEFORE (push events: that SHA directly)
//   3. HEAD~1
// (The underlying library also accepts an explicit --base=<ref>; this wrapper
// keeps the repo contract env-driven.)
//
// Allowlist: config/security/lockfile-freshness-allowlist.json — entries
// { name, version?, reason, expires }. Expired or reason-less entries fail
// the build themselves (fail-closed allowlist, same contract as
// config/security/pqc-allowlist.json).
//
// Implementation lives in the open-source package @aurasec/supply-chain-gates
// (packages/supply-chain-gates) — this wrapper pins this repo's three-workspace
// layout onto it, so CI and the npm package execute the same code.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFreshness } from '../../packages/supply-chain-gates/lib/freshness-gate.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const LOCKFILES = ['package-lock.json', 'app/package-lock.json', 'server/package-lock.json'];
const ALLOWLIST_PATH = join(repoRoot, 'config', 'security', 'lockfile-freshness-allowlist.json');

const fail = (messages) => {
    for (const message of messages) console.error(`[security:lockfile-freshness] ${message}`);
    console.error('[security:lockfile-freshness] FAILED — freshly published versions require an explicit, expiring allowlist entry.');
    process.exit(1);
};

try {
    const result = await checkFreshness({
        lockfiles: LOCKFILES,
        allowlistPath: ALLOWLIST_PATH,
        cwd: repoRoot,
    });
    for (const message of result.logs) console.log(`[security:lockfile-freshness] ${message}`);
    if (!result.ok) {
        fail(result.errors);
    }
} catch (error) {
    fail([String(error.message || error)]);
}
