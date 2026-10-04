// Route derivation: every route a router file declares, prefixed by where
// index.js mounts it. Coverage is derived from source — not hand-maintained —
// so a route that exists in code cannot be missing from the matrix.

const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const HTTP_METHODS = ['post', 'patch', 'put', 'delete'];
const ROUTE_METHODS = [...HTTP_METHODS, 'get'];

/**
 * Extract literal route declarations (`router.post('/x', ...)`) from router
 * source text. Quoted and template-literal paths are both captured; template
 * expressions are not evaluated, so `` router.post(`/x/${id}`) `` is captured
 * as the raw path `/x/${id}` (it probes as a 404 — declare a posture that
 * tolerates that, or `skip` it).
 *
 * @param {string} source contents of a router file
 * @returns {Array<{ method: string, routePath: string }>}
 */
const deriveRoutesFromSource = (source) => {
    const routes = [];
    const routePattern = new RegExp(
        `router\\.(${ROUTE_METHODS.join('|')})\\s*\\(\\s*['"\`]([^'"\`]+)['"\`]`,
        'g'
    );
    let match;
    while ((match = routePattern.exec(source)) !== null) {
        routes.push({ method: match[1].toUpperCase(), routePath: match[2] });
    }
    return routes;
};

/**
 * Derive all routes from a directory of router files, expanded by the mount
 * prefixes declared for each router variable name. Router files without a
 * mount entry are skipped (not mounted, or a helper module).
 *
 * @param {object} options
 * @param {string} options.routesDir directory containing `*.js` router files
 * @param {Record<string, string[]>} options.mountPrefixes router variable name → mount prefixes
 * @param {{ readFileSync: typeof readFileSync, readdirSync: typeof readdirSync }} [options.fsImpl] injectable for tests
 * @returns {Array<{ file: string, method: string, routePath: string, path: string }>}
 */
const deriveRoutes = ({ routesDir, mountPrefixes, fsImpl = { readFileSync, readdirSync } }) => {
    const derived = [];
    const routeFiles = fsImpl
        .readdirSync(routesDir)
        .filter((name) => name.endsWith('.js') && name !== 'index.js');

    for (const fileName of routeFiles) {
        const variableName = fileName.replace(/\.js$/, '');
        const prefixes = mountPrefixes[variableName];
        if (!prefixes) {
            continue; // Not mounted in index.js (or a helper module).
        }
        const source = fsImpl.readFileSync(join(routesDir, fileName), 'utf8');
        for (const route of deriveRoutesFromSource(source)) {
            for (const prefix of prefixes) {
                derived.push({ file: variableName, ...route, path: `${prefix}${route.routePath}` });
            }
        }
    }
    return derived;
};

/**
 * State-changing routes only — the surface an unauthenticated caller must not
 * be able to mutate.
 */
const mutatingRoutes = (routes) =>
    routes.filter((route) => HTTP_METHODS.includes(route.method.toLowerCase()));

module.exports = {
    HTTP_METHODS,
    ROUTE_METHODS,
    deriveRoutes,
    deriveRoutesFromSource,
    mutatingRoutes,
};
