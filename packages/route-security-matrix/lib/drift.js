// Mount-drift detection: the mount table (router variable name → prefixes)
// must exactly cover the routers index.js actually mounts. A newly mounted
// router cannot merge without a declared prefix; a removed router cannot
// leave a stale entry behind.

/**
 * @param {object} options
 * @param {string} options.indexSource contents of the app's index/router-mount file
 * @param {Record<string, string[]>} options.mountPrefixes router variable name → mount prefixes
 * @param {string[]} [options.variableMountRouters] routers mounted with variable or
 *   zero prefixes (env-configured paths, dynamic honeypot routes) — exempt from
 *   the quoted-mount sync check
 * @returns {{ untracked: string[], stale: string[] }}
 */
const checkMountDrift = ({ indexSource, mountPrefixes, variableMountRouters = [] }) => {
    const mounted = new Map();
    const mountPattern = /app\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*([A-Za-z0-9_]+)\s*\)/g;
    let match;
    while ((match = mountPattern.exec(indexSource)) !== null) {
        // Only routers are tracked; middleware mounts (e.g. a rate limiter on
        // /api/admin) are not route files.
        if (match[1].startsWith('/api') && /Routes?$/.test(match[2])) {
            mounted.set(match[2], match[1]);
        }
    }
    const untracked = [...mounted.keys()].filter((variableName) => !mountPrefixes[variableName]);
    const stale = Object.keys(mountPrefixes)
        .filter((variableName) => !mounted.has(variableName))
        .filter((variableName) => !variableMountRouters.includes(variableName));
    return { untracked, stale };
};

module.exports = { checkMountDrift };
