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
//   1. --base=<ref> flag
//   2. $GITHUB_BASE_REF (pull_request events: merge-base with origin/<ref>)
//   3. $GITHUB_EVENT_BEFORE (push events: that SHA directly)
//   4. HEAD~1
//
// Allowlist: config/security/lockfile-freshness-allowlist.json — entries
// { name, version?, reason, expires }. Expired or reason-less entries fail
// the build themselves (fail-closed allowlist, same contract as
// config/security/pqc-allowlist.json).

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COOLDOWN_DAYS = Number(process.argv.find((a) => a.startsWith('--min-age-days='))?.split('=')[1] || 7);
const REGISTRY = 'https://registry.npmjs.org';
const FETCH_TIMEOUT_MS = 20000;
const FETCH_RETRIES = 3;
const FETCH_CONCURRENCY = 8;

const WORKSPACES = ['package-lock.json', 'app/package-lock.json', 'server/package-lock.json'];
const ALLOWLIST_PATH = join(repoRoot, 'config', 'security', 'lockfile-freshness-allowlist.json');

const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();

const fail = (messages) => {
    for (const message of messages) console.error(`[security:lockfile-freshness] ${message}`);
    console.error('[security:lockfile-freshness] FAILED — freshly published versions require an explicit, expiring allowlist entry.');
    process.exit(1);
};

const resolveBase = () => {
    const flag = process.argv.find((a) => a.startsWith('--base='))?.split('=')[1];
    if (flag) return git(['rev-parse', '--verify', flag]);
    const baseRef = process.env.GITHUB_BASE_REF;
    if (baseRef) return git(['merge-base', `origin/${baseRef}`, 'HEAD']);
    const before = process.env.GITHUB_EVENT_BEFORE;
    if (before && /^[0-9a-f]{40}$/.test(before) && existsSync(join(repoRoot, '.git'))) {
        try {
            git(['cat-file', '-e', `${before}^{commit}`]);
            return before;
        } catch { /* SHA not present locally (shallow) — fall through */ }
    }
    return git(['rev-parse', '--verify', 'HEAD~1']);
};

const loadLockfile = (ref, path) => {
    try {
        return JSON.parse(git(['show', `${ref}:${path}`]));
    } catch {
        return null;
    }
};

const extractVersions = (lock) => {
    const versions = new Map();
    for (const [entryPath, entry] of Object.entries(lock?.packages || {})) {
        if (!entryPath || !entry?.version) continue;
        if (entry.link === true || String(entry.resolved || '').startsWith('file:')) continue;
        const name = typeof entry.name === 'string' && entry.name
            ? entry.name
            : entryPath.split('node_modules/').pop();
        versions.set(`${name}@${entry.version}`, name);
    }
    return versions;
};

const loadAllowlist = () => {
    if (!existsSync(ALLOWLIST_PATH)) return { allowed: [] };
    return JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
};

const validateAllowlist = (allowed, now) => {
    const problems = [];
    for (const entry of allowed) {
        if (!entry.name || !entry.reason || !entry.expires) {
            problems.push(`allowlist entry missing name/reason/expires: ${JSON.stringify(entry)}`);
            continue;
        }
        if (new Date(entry.expires).getTime() <= now) {
            problems.push(`allowlist entry for ${entry.name} expired at ${entry.expires} — re-justify or remove it`);
        }
    }
    return problems;
};

const isAllowlisted = (allowed, name, now) => allowed.some((entry) => {
    if (entry.name !== name) return false;
    if (new Date(entry.expires).getTime() <= now) return false;
    return true;
});

const fetchPublishTime = async (name, version) => {
    const url = `${REGISTRY}/${encodeURIComponent(name).replace(/^%40/, '@')}`;
    let lastError = null;
    for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
        try {
            const response = await fetch(url, {
                // Full packument (not the abbreviated install-v1 document) —
                // only the full metadata carries the `time` publish map.
                headers: { accept: 'application/json' },
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            if (!response.ok) throw new Error(`registry responded ${response.status}`);
            const packument = await response.json();
            const publishedAt = packument?.time?.[version];
            if (!publishedAt) throw new Error(`registry has no publish time for ${name}@${version}`);
            return new Date(publishedAt);
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
        }
    }
    throw new Error(`registry lookup failed for ${name}@${version}: ${lastError?.message}`);
};

const main = async () => {
    if (COOLDOWN_DAYS <= 0) fail(['--min-age-days must be a positive number.']);
    const base = resolveBase();
    console.log(`[security:lockfile-freshness] cooldown=${COOLDOWN_DAYS}d, base=${base.slice(0, 12)}`);

    const changed = [];
    for (const lockfile of WORKSPACES) {
        const current = extractVersions(loadLockfile('HEAD', lockfile));
        const previous = extractVersions(loadLockfile(base, lockfile));
        for (const [key, name] of current.entries()) {
            if (!previous.has(key)) changed.push({ lockfile, key, name });
        }
    }

    if (!changed.length) {
        console.log('[security:lockfile-freshness] PASS — no lockfile versions changed against the base revision.');
        return;
    }
    console.log(`[security:lockfile-freshness] ${changed.length} new/changed lockfile version(s) to age-check.`);

    const now = Date.now();
    const { allowed } = loadAllowlist();
    const allowlistProblems = validateAllowlist(allowed, now);
    const failures = [];
    const queue = [...changed];
    const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, async () => {
        while (queue.length) {
            const item = queue.shift();
            try {
                const version = item.key.slice(item.name.length + 1);
                const publishedAt = await fetchPublishTime(item.name, version);
                const ageDays = (now - publishedAt.getTime()) / (24 * 60 * 60 * 1000);
                if (ageDays < COOLDOWN_DAYS && !isAllowlisted(allowed, item.name, now)) {
                    failures.push(
                        `${item.lockfile}: ${item.key} published ${publishedAt.toISOString().slice(0, 10)} `
                        + `(${ageDays.toFixed(1)}d ago, cooldown ${COOLDOWN_DAYS}d).`
                        + ' Wait out the cooldown, or add an expiring entry to config/security/lockfile-freshness-allowlist.json if this is an urgent security fix.'
                    );
                } else if (ageDays < COOLDOWN_DAYS) {
                    console.log(`[security:lockfile-freshness] allowlisted: ${item.key} (${ageDays.toFixed(1)}d)`);
                }
            } catch (error) {
                failures.push(String(error.message || error));
            }
        }
    });
    await Promise.all(workers);

    if (allowlistProblems.length) fail(allowlistProblems);
    if (failures.length) fail(failures);
    console.log(`[security:lockfile-freshness] PASS — all ${changed.length} changed version(s) clear the ${COOLDOWN_DAYS}d cooldown (or are allowlisted).`);
};

main().catch((error) => fail([String(error.message || error)]));
