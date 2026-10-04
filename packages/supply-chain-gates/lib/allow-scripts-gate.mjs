// Lifecycle-script allowlist gate.
//
// npm's native `allowScripts` package.json field (warning in npm 11, enforced
// by default in npm 12) controls which packages may run preinstall/install/
// postinstall scripts. CI commonly runs `npm ci` with secrets present
// (GITHUB_TOKEN, cloud deploy credentials), so a poisoned transitive lifecycle
// script is the exfiltration vector behind the 2025-2026 npm worm waves —
// npm 11 only WARNS about uncovered scripts, which is not enforcement.
//
// This gate parses lockfiles for `hasInstallScript: true` entries and fails
// when a package is not covered by its workspace's `allowScripts` map — and
// also when an allowlist entry has no matching install-script package anymore
// (keeps the list honest; remove stale entries).

import { readFileSync, existsSync } from 'node:fs';

/**
 * @param {object} options
 * @param {Array<{ name: string, lockfile: string, packageJson: string }>} options.workspaces
 *   One entry per lockfile to check. `name` is used only in output messages.
 * @param {typeof import('node:fs').readFileSync} [options.readFileSyncImpl] injectable for tests
 * @param {typeof import('node:fs').existsSync} [options.existsSyncImpl] injectable for tests
 * @returns {{ ok: boolean, logs: string[], errors: string[] }}
 */
export const checkAllowScripts = ({ workspaces, readFileSyncImpl = readFileSync, existsSyncImpl = existsSync }) => {
    const logs = [];
    const errors = [];

    for (const workspace of workspaces) {
        const lockfilePath = workspace.lockfile;
        if (!existsSyncImpl(lockfilePath)) {
            errors.push(`${lockfilePath}: lockfile missing.`);
            continue;
        }
        const lock = JSON.parse(readFileSyncImpl(lockfilePath, 'utf8'));
        const pkg = JSON.parse(readFileSyncImpl(workspace.packageJson, 'utf8'));
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
                errors.push(
                    `${workspace.name}: install-script package "${name}" (${entryPath}) is not allowlisted.`
                    + ' If its lifecycle script is genuinely needed, add `"allowScripts": { "' + name + '": true }` to '
                    + workspace.packageJson + ' with a review of what the script does; otherwise investigate.'
                );
            }
        }

        for (const name of Object.keys(allowScripts).sort()) {
            if (!scriptPackages.has(name)) {
                errors.push(
                    `${workspace.name}: allowScripts entry "${name}" covers no install-script package in `
                    + lockfilePath + ' — remove the stale entry.'
                );
            }
        }

        if (!errors.length) {
            logs.push(`${workspace.name}: ${scriptPackages.size} install-script package(s), all allowlisted.`);
        }
    }

    return { ok: errors.length === 0, logs, errors };
};
