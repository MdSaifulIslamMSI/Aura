// Lockfile registry lint.
//
// Every registry-sourced entry in a lockfile must resolve to the official npm
// registry over HTTPS with a URL whose package path matches the entry, and
// must carry an integrity hash. Anything else (arbitrary hosts, git+ URLs,
// tarball URLs, missing integrity) is exactly how a hand-edited or poisoned
// lockfile smuggles attacker-controlled tarballs past a frozen `npm ci`.
//
// Exceptions: `link:` entries (workspace/file links whose targets live
// outside node_modules, no tarball involved) are skipped.

import { readFileSync, existsSync } from 'node:fs';

export const DEFAULT_REGISTRY_HOST = 'registry.npmjs.org';

const expectedTarballPath = (name, version) => {
    const basename = name.startsWith('@') ? name.split('/')[1] : name;
    return `/${name}/-/${basename}-${version}.tgz`;
};

/**
 * @param {object} options
 * @param {string[]} options.lockfiles lockfile paths to lint
 * @param {string} [options.registryHost] default registry.npmjs.org
 * @param {typeof import('node:fs').readFileSync} [options.readFileSyncImpl] injectable for tests
 * @param {typeof import('node:fs').existsSync} [options.existsSyncImpl] injectable for tests
 * @returns {{ ok: boolean, logs: string[], errors: string[] }}
 */
export const checkRegistry = ({ lockfiles, registryHost = DEFAULT_REGISTRY_HOST, readFileSyncImpl = readFileSync, existsSyncImpl = existsSync }) => {
    const logs = [];
    const errors = [];

    for (const lockfilePath of lockfiles) {
        if (!existsSyncImpl(lockfilePath)) {
            errors.push(`${lockfilePath}: lockfile missing.`);
            continue;
        }
        const lock = JSON.parse(readFileSyncImpl(lockfilePath, 'utf8'));

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
                errors.push(`${lockfilePath}: "${entryPath}" does not resolve over HTTPS to the npm registry: ${resolved || '(no resolved URL)'}`);
                continue;
            }

            let url;
            try {
                url = new URL(resolved);
            } catch {
                errors.push(`${lockfilePath}: "${entryPath}" has an unparseable resolved URL: ${resolved}`);
                continue;
            }
            if (url.hostname !== registryHost) {
                errors.push(`${lockfilePath}: "${entryPath}" resolves outside https://${registryHost}: ${resolved}`);
                continue;
            }
            const version = typeof entry.version === 'string' ? entry.version : '';
            if (version && url.pathname !== expectedTarballPath(declaredName, version)) {
                errors.push(`${lockfilePath}: "${entryPath}" tarball path does not match ${declaredName}@${version}: ${resolved}`);
                continue;
            }
            // sha512 only — weaker legacy hash acceptance (sha1) is exactly what
            // a collision attack against a lockfile needs.
            if (!/^sha512-/.test(String(entry.integrity || ''))) {
                errors.push(`${lockfilePath}: "${entryPath}" is missing a sha512 integrity hash.`);
                continue;
            }
            checked += 1;
        }

        if (!errors.length) {
            logs.push(`${lockfilePath}: ${checked} registry entr(ies) verified against https://${registryHost}.`);
        }
    }

    return { ok: errors.length === 0, logs, errors };
};
