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

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY_HOST = 'registry.npmjs.org';

const WORKSPACES = [
    { name: 'root', lockfile: 'package-lock.json', packageJson: 'package.json' },
    { name: 'app', lockfile: 'app/package-lock.json', packageJson: 'app/package.json' },
    { name: 'server', lockfile: 'server/package-lock.json', packageJson: 'server/package.json' },
];

const fail = (messages) => {
    for (const message of messages) console.error(`[security:lockfile-registry] ${message}`);
    console.error('[security:lockfile-registry] FAILED — lockfiles must resolve only to the official npm registry.');
    process.exit(1);
};

const expectedTarballPath = (name, version) => {
    const basename = name.startsWith('@') ? name.split('/')[1] : name;
    return `/${name}/-/${basename}-${version}.tgz`;
};

const messages = [];

for (const workspace of WORKSPACES) {
    const lockfilePath = join(repoRoot, workspace.lockfile);
    if (!existsSync(lockfilePath)) {
        messages.push(`${workspace.lockfile}: lockfile missing.`);
        continue;
    }
    const lock = JSON.parse(readFileSync(lockfilePath, 'utf8'));

    let checked = 0;
    for (const [entryPath, entry] of Object.entries(lock.packages || {})) {
        // The root entry and link-target entries outside node_modules carry no
        // tarball; only installed packages are validated.
        if (!entryPath || !entryPath.startsWith('node_modules/') || entry.link === true) continue;
        const declaredName = typeof entry.name === 'string' && entry.name
            ? entry.name
            : entryPath.split('node_modules/').pop();

        const resolved = typeof entry.resolved === 'string' ? entry.resolved : '';
        if (!resolved.startsWith('https://')) {
            messages.push(`${workspace.lockfile}: "${entryPath}" does not resolve over HTTPS to the npm registry: ${resolved || '(no resolved URL)'}`);
            continue;
        }

        let url;
        try {
            url = new URL(resolved);
        } catch {
            messages.push(`${workspace.lockfile}: "${entryPath}" has an unparseable resolved URL: ${resolved}`);
            continue;
        }
        if (url.hostname !== REGISTRY_HOST) {
            messages.push(`${workspace.lockfile}: "${entryPath}" resolves outside https://${REGISTRY_HOST}: ${resolved}`);
            continue;
        }
        const version = typeof entry.version === 'string' ? entry.version : '';
        if (version && url.pathname !== expectedTarballPath(declaredName, version)) {
            messages.push(`${workspace.lockfile}: "${entryPath}" tarball path does not match ${declaredName}@${version}: ${resolved}`);
            continue;
        }
        // sha512 only — the PQC policy forbids weaker legacy hash acceptance,
        // and every entry in all three lockfiles is sha512 (verified 2026-10-02).
        if (!/^sha512-/.test(String(entry.integrity || ''))) {
            messages.push(`${workspace.lockfile}: "${entryPath}" is missing a sha512 integrity hash.`);
            continue;
        }
        checked += 1;
    }

    if (!messages.length) {
        console.log(`[security:lockfile-registry] ${workspace.name}: ${checked} registry entr(ies) verified against https://${REGISTRY_HOST}.`);
    }
}

if (messages.length) fail(messages);

console.log('[security:lockfile-registry] PASS — every lockfile resolution is the official npm registry with an integrity hash.');
