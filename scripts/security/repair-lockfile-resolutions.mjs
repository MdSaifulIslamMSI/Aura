#!/usr/bin/env node
// Repair a lockfile whose entries lost their resolved/integrity metadata
// (first seen after #569 on 2026-09-26: 871 server entries had version but no
// resolved — every `npm ci` re-trusted live registry metadata instead of the
// frozen hashes). Fetches the registry metadata for each pinned version and
// fills resolved + integrity in place. NO version is changed; packages that
// already carry resolved+integrity are left untouched.
//
// Usage: node scripts/security/repair-lockfile-resolutions.mjs [--write]
//   Without --write: dry run, reports what would be repaired.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WRITE = process.argv.includes('--write');
const REGISTRY = 'https://registry.npmjs.org';
const FETCH_TIMEOUT_MS = 20000;
const FETCH_RETRIES = 3;
const FETCH_CONCURRENCY = 10;

const WORKSPACES = ['package-lock.json', 'app/package-lock.json', 'server/package-lock.json'];

const fail = (messages) => {
    for (const message of messages) console.error(`[security:repair-lockfile] ${message}`);
    process.exit(1);
};

const fetchMetadata = async (name) => {
    const url = `${REGISTRY}/${encodeURIComponent(name).replace(/^%40/, '@')}`;
    let lastError = null;
    for (let attempt = 1; attempt <= FETCH_RETRIES; attempt += 1) {
        try {
            const response = await fetch(url, {
                headers: { accept: 'application/vnd.npm.install-v1+json' },
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            if (!response.ok) throw new Error(`registry responded ${response.status}`);
            return await response.json();
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
        }
    }
    throw new Error(`registry lookup failed for ${name}: ${lastError?.message}`);
};

const repairLockfile = async (lockfilePath) => {
    const fullPath = join(repoRoot, lockfilePath);
    const lock = JSON.parse(readFileSync(fullPath, 'utf8'));
    const repairs = [];
    const queue = [];

    for (const [entryPath, entry] of Object.entries(lock.packages || {})) {
        if (!entryPath.startsWith('node_modules/') || entry.link === true) continue;
        if (entry.resolved && entry.integrity) continue;
        const name = typeof entry.name === 'string' && entry.name
            ? entry.name
            : entryPath.split('node_modules/').pop();
        if (!entry.version) {
            fail([`${lockfilePath}: "${entryPath}" has neither resolved/integrity nor a version to repair from.`]);
        }
        queue.push({ entryPath, entry, name, version: entry.version });
    }

    console.log(`[security:repair-lockfile] ${lockfilePath}: ${queue.length} entr(ies) need resolved/integrity.`);

    const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length || 1) }, async () => {
        while (queue.length) {
            const item = queue.shift();
            const packument = await fetchMetadata(item.name);
            const manifest = packument?.versions?.[item.version];
            if (!manifest?.dist?.tarball || !manifest?.dist?.integrity) {
                fail([`${lockfilePath}: "${item.entryPath}" — registry has no dist metadata for ${item.name}@${item.version}.`]);
            }
            const expectedTarball = `/${item.name}/-/${item.name.startsWith('@') ? item.name.split('/')[1] : item.name}-${item.version}.tgz`;
            const tarball = new URL(manifest.dist.tarball);
            if (tarball.hostname !== 'registry.npmjs.org' || tarball.pathname !== expectedTarball) {
                fail([`${lockfilePath}: "${item.entryPath}" — registry tarball ${manifest.dist.tarball} does not match the official registry path for ${item.name}@${item.version}.`]);
            }
            item.entry.resolved = manifest.dist.tarball;
            item.entry.integrity = manifest.dist.integrity;
            repairs.push(item.entryPath);
        }
    });
    await Promise.all(workers);

    if (WRITE && repairs.length) {
        writeFileSync(fullPath, JSON.stringify(lock, null, 2) + '\n');
    }
    console.log(`[security:repair-lockfile] ${lockfilePath}: ${repairs.length} entr(ies) ${WRITE ? 'repaired and written' : 'would be repaired (dry run)'}.`);
    return repairs.length;
};

let total = 0;
for (const lockfilePath of WORKSPACES) total += await repairLockfile(lockfilePath);
if (!total) {
    console.log('[security:repair-lockfile] Nothing to repair — all entries carry resolved+integrity.');
} else if (!WRITE) {
    console.log('[security:repair-lockfile] Re-run with --write to apply.');
} else {
    console.log(`[security:repair-lockfile] DONE — ${total} entr(ies) repaired across the lockfiles. Run the registry lint to verify.`);
}
