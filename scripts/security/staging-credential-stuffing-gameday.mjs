#!/usr/bin/env node
// Phase 3 game-day: controlled credential-stuffing simulation against staging.
// Proves the brute-force chain end to end: failure counting -> lockout
// engagement (or rate-limit containment) -> observable 429s -> postmortem.
//
// Safety: refuses anything production-like, requires explicit arming, caps
// the burst well below abuse thresholds, uses a synthetic game-day identity
// only, and defaults to --dry-run (no requests). Live fire needs:
//   STAGING_API_BASE_URL=https://<staging-backend>
//   SMOKE_TARGET_ENV=staging
//   STAGING_GAMEDAY_ARM=1 node scripts/security/staging-credential-stuffing-gameday.mjs --execute
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    isKnownProductionHost,
    looksProductionLike,
    normalize,
} from '../env-contract-lib.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '..', '..');

const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
const ATTEMPTS = 10;
const DELAY_MS = 1500;
const REQUEST_TIMEOUT_MS = 15000;

const failures = [];
const requireEnv = (name) => {
    const value = normalize(process.env[name]);
    if (!value) failures.push(`${name} is required for the game-day.`);
    return value;
};

const apiBase = requireEnv('STAGING_API_BASE_URL').replace(/\/+$/, '');
const smokeTargetEnv = requireEnv('SMOKE_TARGET_ENV');
if (smokeTargetEnv !== 'staging') {
    failures.push('SMOKE_TARGET_ENV must be staging.');
}

let targetHost = '';
try {
    targetHost = new URL(apiBase).hostname.toLowerCase();
} catch {
    failures.push('STAGING_API_BASE_URL must be an absolute URL.');
}
if (targetHost && (isKnownProductionHost(targetHost) || looksProductionLike(targetHost))) {
    failures.push(`Refusing game-day against production-like host: ${targetHost}.`);
}
if (!execute) {
    console.log('[gameday] DRY RUN (pass --execute with STAGING_GAMEDAY_ARM=1 to fire).');
    console.log(`[gameday] Target: ${apiBase || '(missing)'}`);
    console.log(`[gameday] Plan: ${ATTEMPTS} bad recovery-code verifies, ${DELAY_MS}ms apart.`);
    if (failures.length > 0) {
        console.error('[gameday] BLOCKED:');
        for (const failure of failures) console.error(`  - ${failure}`);
        process.exit(1);
    }
    console.log('[gameday] Guards pass.');
    process.exit(0);
}
if (normalize(process.env.STAGING_GAMEDAY_ARM).toLowerCase() !== '1') {
    console.error('[gameday] Refusing live fire without STAGING_GAMEDAY_ARM=1.');
    process.exit(1);
}
if (failures.length > 0) {
    console.error('[gameday] BLOCKED:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const gameEmail = `gameday-${Date.now()}@example.com`;

const fireOnce = async (index) => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`${apiBase}/api/auth/recovery-codes/verify`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: gameEmail, code: '000000-wrong' }),
            signal: controller.signal,
        });
        let body = {};
        try {
            body = await res.json();
        } catch {
            body = {};
        }
        return { index, status: res.status, code: body.code || '', ms: Date.now() - startedAt };
    } catch (error) {
        return { index, status: 0, code: `transport:${error?.name || 'error'}`, ms: Date.now() - startedAt };
    } finally {
        clearTimeout(timer);
    }
};

const timeline = [];
for (let i = 0; i < ATTEMPTS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const attempt = await fireOnce(i);
    timeline.push(attempt);
    console.log(`[gameday] attempt ${i}: status=${attempt.status} code=${attempt.code} ms=${attempt.ms}`);
    if (i < ATTEMPTS - 1) await sleep(DELAY_MS);
}

const locked = timeline.filter((t) => t.code === 'ACCOUNT_TEMPORARILY_LOCKED');
const rateLimited = timeline.filter((t) => t.status === 429 && t.code !== 'ACCOUNT_TEMPORARILY_LOCKED');
const verdict = locked.length > 0
    ? 'LOCKOUT_ENGAGED'
    : (rateLimited.length > 0 ? 'RATE_LIMIT_CONTAINED' : 'NO_CONTAINMENT_OBSERVED');

const artifact = {
    generatedAt: new Date().toISOString(),
    target: `${apiBase}/api/auth/recovery-codes/verify`,
    identity: gameEmail,
    attempts: ATTEMPTS,
    verdict,
    lockedHits: locked.length,
    rateLimitedHits: rateLimited.length,
    timeline,
};
const outDir = path.join(repoDir, 'artifacts', 'security');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'gameday-credential-stuffing.json');
fs.writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`[gameday] verdict=${verdict} artifact=${outPath}`);
if (verdict === 'NO_CONTAINMENT_OBSERVED') process.exit(1);
