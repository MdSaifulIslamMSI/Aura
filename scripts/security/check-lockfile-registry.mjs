#!/usr/bin/env node
// Lockfile registry lint.
//
// Every registry-sourced entry in the three lockfiles must resolve to the
// official npm registry over HTTPS with a URL whose package path matches the
// entry, and must carry an integrity hash. Anything else (arbitrary hosts,
// git+ URLs, tarball URLs, missing integrity) is exactly how a hand-edited or
// poisoned lockfile smuggles attacker-controlled tarballs past a frozen
// `npm ci`.
//
// Exceptions: `link:` entries (workspace/file links whose targets live
// outside node_modules, no tarball involved) — the repo has exactly one,
// server's vendored node-domexception.
//
// Implementation lives in the open-source package @aurasec/supply-chain-gates
// (packages/supply-chain-gates) — this wrapper pins this repo's three-workspace
// layout onto it, so CI and the npm package execute the same code.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRegistry } from '../../packages/supply-chain-gates/lib/registry-gate.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const LOCKFILES = ['package-lock.json', 'app/package-lock.json', 'server/package-lock.json'];

const result = checkRegistry({
    lockfiles: LOCKFILES.map((lockfile) => join(repoRoot, lockfile)),
});

for (const message of result.logs) console.log(`[security:lockfile-registry] ${message}`);

if (!result.ok) {
    for (const message of result.errors) console.error(`[security:lockfile-registry] ${message}`);
    console.error('[security:lockfile-registry] FAILED — lockfiles must resolve only to the official npm registry.');
    process.exit(1);
}

console.log('[security:lockfile-registry] PASS — every lockfile resolution is the official npm registry with an integrity hash.');
