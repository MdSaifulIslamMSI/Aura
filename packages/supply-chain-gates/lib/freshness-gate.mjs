// Release-cooldown gate: no lockfile entry may point at a version published
// more recently than the cooldown window, unless explicitly allowlisted.
//
// Rationale: poisoned npm releases (the 2025-2026 worm waves) are typically
// yanked from the registry within days of publication. A repo that automerges
// dependency bumps can otherwise flow a same-day malicious release from the
// registry to a production lockfile without a human in the loop. Requiring an
// age floor on NEW lockfile versions gives the community time to flag a
// poisoned release before it reaches CI.
//
// Scope: only lockfile versions that CHANGED relative to a base revision are
// checked — the gate costs one registry lookup per changed package, not per
// tree. Base resolution order:
//   1. `base` option / --base=<ref> flag
//   2. $GITHUB_BASE_REF (pull_request events: merge-base with origin/<ref>)
//   3. $GITHUB_EVENT_BEFORE (push events: that SHA directly)
//   4. HEAD~1
//
// Allowlist: a JSON file `{ "allowed": [ { name, version?, reason, expires } ] }`.
// Expired or reason-less entries fail the build themselves (fail-closed
// allowlist).

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const DEFAULT_MIN_AGE_DAYS = 7;
export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const FETCH_TIMEOUT_MS = 20000;
const FETCH_RETRIES = 3;
const FETCH_CONCURRENCY = 8;

const defaultGit = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

export const resolveBase = ({ base, env = process.env, git = defaultGit, cwd = process.cwd() }) => {
    if (base) return git(['rev-parse', '--verify', base], cwd);
    const baseRef = env.GITHUB_BASE_REF;
    if (baseRef) return git(['merge-base', `origin/${baseRef}`, 'HEAD'], cwd);
    const before = env.GITHUB_EVENT_BEFORE;
    if (before && /^[0-9a-f]{40}$/.test(before) && existsSync(`${cwd}/.git`)) {
        try {
            git(['cat-file', '-e', `${before}^{commit}`], cwd);
            return before;
        } catch { /* SHA not present locally (shallow) — fall through */ }
    }
    return git(['rev-parse', '--verify', 'HEAD~1'], cwd);
};

const loadLockfile = (git, cwd, ref, path) => {
    try {
        return JSON.parse(git(['show', `${ref}:${path}`], cwd));
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

const loadAllowlist = (allowlistPath) => {
    if (!allowlistPath || !existsSync(allowlistPath)) return { allowed: [] };
    return JSON.parse(readFileSync(allowlistPath, 'utf8'));
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

export const fetchPublishTime = async (registryUrl, name, version, fetchImpl = fetch) => {
    const url = `${registryUrl}/${encodeURIComponent(name).replace(/^%40/, '@')}`;
    let lastError = null;
    for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
        try {
            const response = await fetchImpl(url, {
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

/**
 * @param {object} options
 * @param {string[]} options.lockfiles lockfile paths (read via `git show`)
 * @param {number} [options.minAgeDays] cooldown window in days (default 7)
 * @param {string} [options.allowlistPath] path to the fail-closed allowlist JSON
 * @param {string} [options.base] explicit base revision
 * @param {string} [options.registryUrl]
 * @param {object} [options.env] environment for base resolution (default process.env)
 * @param {(args: string[], cwd: string) => string} [options.git] injectable for tests
 * @param {string} [options.cwd] working directory for git (default process.cwd())
 * @param {typeof fetch} [options.fetchImpl] injectable for tests
 * @param {number} [options.now] epoch ms override for tests
 * @returns {Promise<{ ok: boolean, logs: string[], errors: string[] }>}
 */
export const checkFreshness = async ({
    lockfiles,
    minAgeDays = DEFAULT_MIN_AGE_DAYS,
    allowlistPath,
    base,
    registryUrl = DEFAULT_REGISTRY,
    env = process.env,
    git = defaultGit,
    cwd = process.cwd(),
    fetchImpl = fetch,
    now = Date.now(),
}) => {
    const logs = [];
    const errors = [];

    if (!Number.isFinite(minAgeDays) || minAgeDays <= 0) {
        return { ok: false, logs, errors: ['--min-age-days must be a positive number.'] };
    }

    const baseRev = resolveBase({ base, env, git, cwd });
    logs.push(`cooldown=${minAgeDays}d, base=${baseRev.slice(0, 12)}`);

    const changed = [];
    for (const lockfile of lockfiles) {
        const current = extractVersions(loadLockfile(git, cwd, 'HEAD', lockfile));
        const previous = extractVersions(loadLockfile(git, cwd, baseRev, lockfile));
        for (const [key, name] of current.entries()) {
            if (!previous.has(key)) changed.push({ lockfile, key, name });
        }
    }

    if (!changed.length) {
        logs.push('PASS — no lockfile versions changed against the base revision.');
        return { ok: true, logs, errors };
    }
    logs.push(`${changed.length} new/changed lockfile version(s) to age-check.`);

    const { allowed } = loadAllowlist(allowlistPath);
    const allowlistProblems = validateAllowlist(allowed, now);
    const failures = [];
    const queue = [...changed];
    const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, async () => {
        while (queue.length) {
            const item = queue.shift();
            try {
                const version = item.key.slice(item.name.length + 1);
                const publishedAt = await fetchPublishTime(registryUrl, item.name, version, fetchImpl);
                const ageDays = (now - publishedAt.getTime()) / (24 * 60 * 60 * 1000);
                if (ageDays < minAgeDays && !isAllowlisted(allowed, item.name, now)) {
                    failures.push(
                        `${item.lockfile}: ${item.key} published ${publishedAt.toISOString().slice(0, 10)} `
                        + `(${ageDays.toFixed(1)}d ago, cooldown ${minAgeDays}d).`
                        + ' Wait out the cooldown, or add an expiring allowlist entry if this is an urgent security fix.'
                    );
                } else if (ageDays < minAgeDays) {
                    logs.push(`allowlisted: ${item.key} (${ageDays.toFixed(1)}d)`);
                }
            } catch (error) {
                failures.push(String(error.message || error));
            }
        }
    });
    await Promise.all(workers);

    if (allowlistProblems.length) errors.push(...allowlistProblems);
    if (failures.length) errors.push(...failures);
    if (!errors.length) {
        logs.push(`PASS — all ${changed.length} changed version(s) clear the ${minAgeDays}d cooldown (or are allowlisted).`);
    }
    return { ok: errors.length === 0, logs, errors };
};
