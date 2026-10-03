#!/usr/bin/env node
// Lifecycle-script allowlist gate.
//
// npm's native `allowScripts` package.json field (warning in npm 11, enforced
// by default in npm 12) controls which packages may run preinstall/install/
// postinstall scripts. This repo runs `npm ci` in CI with secrets present
// (GITHUB_TOKEN, AWS deploy credentials), so a poisoned transitive lifecycle
// script is the exfiltration vector behind the 2025-2026 npm worm waves —
// npm 11 only WARNS about uncovered scripts, which is not enforcement.
//
// This gate parses the three lockfiles for `hasInstallScript: true` entries
// and fails when a package is not covered by its workspace's `allowScripts`
// map — and also when an allowlist entry has no matching install-script
// package anymore (keeps the list honest; remove stale entries).

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const WORKSPACES = [
    { name: 'root', lockfile: 'package-lock.json', packageJson: 'package.json' },
    { name: 'app', lockfile: 'app/package-lock.json', packageJson: 'app/package.json' },
    { name: 'server', lockfile: 'server/package-lock.json', packageJson: 'server/package.json' },
];

const fail = (messages) => {
    for (const message of messages) console.error(`[security:install-scripts] ${message}`);
    console.error('[security:install-scripts] FAILED — lifecycle scripts must be explicitly allowlisted.');
    process.exit(1);
};

const loadJson = (path) => JSON.parse(readFileSync(join(repoRoot, path), 'utf8'));

const messages = [];

for (const workspace of WORKSPACES) {
    const lockfilePath = join(repoRoot, workspace.lockfile);
    if (!existsSync(lockfilePath)) {
        messages.push(`${workspace.lockfile}: lockfile missing.`);
        continue;
    }
    const lock = JSON.parse(readFileSync(lockfilePath, 'utf8'));
    const pkg = loadJson(workspace.packageJson);
    const allowScripts = pkg.allowScripts && typeof pkg.allowScripts === 'object' ? pkg.allowScripts : {};

    const scriptPackages = new Map();
    for (const [entryPath, entry] of Object.entries(lock.packages || {})) {
        if (!entry.hasInstallScript) continue;
        const declaredName = typeof entry.name === 'string' && entry.name
            ? entry.name
            : entryPath.split('node_modules/').pop();
        scriptPackages.set(declaredName, entryPath);
    }

    for (const [name, entryPath] of [...scriptPackages.entries()].sort()) {
        const value = allowScripts[name];
        if (value !== true) {
            messages.push(
                `${workspace.name}: install-script package "${name}" (${entryPath}) is not allowlisted.`
                + ' If its lifecycle script is genuinely needed, add `"allowScripts": { "' + name + '": true }` to '
                + workspace.packageJson + ' with a review of what the script does; otherwise investigate.'
            );
        }
    }

    for (const name of Object.keys(allowScripts).sort()) {
        if (!scriptPackages.has(name)) {
            messages.push(
                `${workspace.name}: allowScripts entry "${name}" covers no install-script package in `
                + workspace.lockfile + ' — remove the stale entry.'
            );
        }
    }

    if (!messages.length) {
        console.log(`[security:install-scripts] ${workspace.name}: ${scriptPackages.size} install-script package(s), all allowlisted.`);
    }
}

if (messages.length) fail(messages);

console.log('[security:install-scripts] PASS — every lifecycle script package is explicitly allowlisted.');
