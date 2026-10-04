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
// Implementation lives in the open-source package @aurasec/supply-chain-gates
// (packages/supply-chain-gates) — this wrapper pins this repo's three-workspace
// layout onto it, so CI and the npm package execute the same code.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAllowScripts } from '../../packages/supply-chain-gates/lib/allow-scripts-gate.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const WORKSPACES = [
    { name: 'root', lockfile: 'package-lock.json', packageJson: 'package.json' },
    { name: 'app', lockfile: 'app/package-lock.json', packageJson: 'app/package.json' },
    { name: 'server', lockfile: 'server/package-lock.json', packageJson: 'server/package.json' },
];

const result = checkAllowScripts({
    workspaces: WORKSPACES.map((workspace) => ({
        name: workspace.name,
        lockfile: join(repoRoot, workspace.lockfile),
        packageJson: join(repoRoot, workspace.packageJson),
    })),
});

for (const message of result.logs) console.log(`[security:install-scripts] ${message}`);

if (!result.ok) {
    for (const message of result.errors) console.error(`[security:install-scripts] ${message}`);
    console.error('[security:install-scripts] FAILED — lifecycle scripts must be explicitly allowlisted.');
    process.exit(1);
}

console.log('[security:install-scripts] PASS — every lifecycle script package is explicitly allowlisted.');
