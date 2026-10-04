// @aurasec/route-security-matrix
//
// Route security middleware is composed per route file, so coverage is hard
// to prove by reading code. This package derives every route directly from
// the router files plus the mounts in the app's index file and enforces two
// guarantees:
//   1. Coverage — every derived state-changing route must have a declared
//      security posture. A new mutating route cannot merge without an
//      explicit posture decision.
//   2. Behavior — every declared guarded route must actually reject an
//      unauthenticated request; declared-public/webhook routes must not 5xx.
//
// The test factory is framework-agnostic by injection: pass your runner's
// `describe`/`test`/`expect`/`afterAll` (Jest shown in the README) and a
// supertest instance — this package itself has zero dependencies.

const fs = require('node:fs');
const path = require('node:path');

const { deriveRoutes, deriveRoutesFromSource, mutatingRoutes } = require('./derive');
const { POSTURES, overrideKey, resolvePosture, resolveProbePath, statusSatisfiesPosture } = require('./posture');
const { checkMountDrift } = require('./drift');

/**
 * Build the default unauthenticated probe: supertest request against the app,
 * body `{}` on mutating methods, `:param` segments replaced with a plausible id.
 *
 * @param {object} app express app instance
 * @param {Function} request supertest
 * @param {string} [pathParamId]
 * @returns {(route: { method: string, path: string }) => Promise<number>} observed status
 */
const createSupertestProbe = (app, request, pathParamId) => async (route) => {
    const lower = route.method.toLowerCase();
    let req = request(app)[lower](resolveProbePath(route.path, pathParamId));
    if (route.method.toLowerCase() !== 'get') {
        req = req.send({});
    }
    const res = await req;
    return res.statusCode;
};

/**
 * A misspelled posture would silently weaken its probes (unknown postures do
 * not fail on 2xx), so the whole vocabulary is validated before any test is
 * registered.
 */
const validatePostureVocabulary = ({ routePostures, routePostureOverrides }) => {
    const problems = [];
    for (const [file, posture] of Object.entries(routePostures || {})) {
        if (!POSTURES.includes(posture)) {
            problems.push(`routePostures["${file}"] has unknown posture "${posture}" (allowed: ${POSTURES.join(', ')})`);
        }
    }
    for (const [key, posture] of Object.entries(routePostureOverrides || {})) {
        if (!POSTURES.includes(posture)) {
            problems.push(`routePostureOverrides["${key}"] has unknown posture "${posture}"`);
        }
    }
    return problems;
};

/**
 * Register the route-security-matrix suite on the supplied test runtime.
 *
 * @param {object} testRuntime framework globals: `{ describe, test, expect, afterAll, setTimeout? }`
 *   (Jest: `setTimeout: jest.setTimeout`)
 * @param {object} config
 * @param {object} config.app the express app under test
 * @param {Function} config.request supertest (or compatible) request factory
 * @param {string} config.routesDir directory containing `*.js` router files
 * @param {string} [config.indexFile] app file whose `app.use('/api/...', xRoutes)`
 *   mounts feed the drift check
 * @param {Record<string, string[]>} config.mountPrefixes router variable name → mount prefixes
 * @param {Record<string, string>} config.routePostures file-level default postures
 * @param {Record<string, string>} [config.routePostureOverrides] per-route postures keyed `"METHOD <mounted-path>"`
 * @param {string[]} [config.variableMountRouters] routers exempt from the drift check
 * @param {string} [config.pathParamId] value substituted for `:param` segments when probing
 * @param {string} [config.declarationHint] pointer shown when a route has no posture
 * @param {string} [config.reportPath] write the derived-route report here
 *   (overridable per-run via `ROUTE_MATRIX_REPORT`)
 * @param {number} [config.testTimeoutMs] per-suite timeout (default 60000)
 */
const createRouteMatrixTests = (testRuntime, config) => {
    const {
        describe, test, expect, afterAll, setTimeout: setTestTimeout,
    } = testRuntime;
    const {
        app,
        request,
        routesDir,
        indexFile,
        mountPrefixes,
        routePostures,
        routePostureOverrides = {},
        variableMountRouters = [],
        pathParamId,
        declarationHint = 'the route-security-matrix config',
        reportPath,
        testTimeoutMs = 60000,
    } = config;

    if (!app || !request || !routesDir || !mountPrefixes) {
        throw new Error('createRouteMatrixTests requires app, request, routesDir and mountPrefixes.');
    }

    const postureProblems = validatePostureVocabulary({ routePostures, routePostureOverrides });
    if (postureProblems.length) {
        throw new Error(`Invalid route-security-matrix config:\n  ${postureProblems.join('\n  ')}`);
    }

    const fsImpl = config.fsImpl || fs;
    const routes = deriveRoutes({ routesDir, mountPrefixes, fsImpl });
    const mutating = mutatingRoutes(routes);
    const postureFor = (route) => resolvePosture(route, { routePostures, routePostureOverrides });
    const probeRoute = createSupertestProbe(app, request, pathParamId);
    const effectiveReportPath = reportPath || process.env.ROUTE_MATRIX_REPORT;

    if (setTestTimeout) setTestTimeout(testTimeoutMs);

    return describe('Route security matrix', () => {
        if (afterAll) {
            afterAll(async () => {
                if (!effectiveReportPath) return;
                const report = [];
                for (const route of mutating) {
                    const status = await probeRoute(route);
                    report.push({ ...route, posture: postureFor(route), observedStatus: status });
                }
                fsImpl.mkdirSync(path.dirname(effectiveReportPath), { recursive: true });
                fsImpl.writeFileSync(effectiveReportPath, JSON.stringify(report, null, 2));
            });
        }

        test('every state-changing route is declared in the security posture inventory', () => {
            const undeclared = mutating.filter((route) => postureFor(route) === 'undeclared');
            if (undeclared.length > 0) {
                const message = undeclared
                    .map((route) => `${route.method} ${route.path} (${route.file}.js)`)
                    .join('\n  ');
                throw new Error(
                    `Undeclared state-changing routes — add a posture in ${declarationHint}:\n  ${message}`
                );
            }
            expect(undeclared).toHaveLength(0);
        });

        if (indexFile) {
            test('declared mount prefixes cover every mounted route file', () => {
                const indexSource = fsImpl.readFileSync(indexFile, 'utf8');
                const { untracked, stale } = checkMountDrift({ indexSource, mountPrefixes, variableMountRouters });
                if (untracked.length > 0 || stale.length > 0) {
                    throw new Error(
                        `Mount drift — untracked: ${untracked.join(', ') || 'none'}; stale: ${stale.join(', ') || 'none'}`
                    );
                }
                expect({ untracked, stale }).toEqual({ untracked: [], stale: [] });
            });
        }

        for (const route of mutating.filter((route) => postureFor(route) !== 'skip')) {
            test(`${route.method} ${route.path} rejects or safely handles unauthenticated requests`, async () => {
                const status = await probeRoute(route);
                expect(statusSatisfiesPosture(status, postureFor(route))).toBe(true);
            });
        }
    });
};

module.exports = {
    POSTURES,
    checkMountDrift,
    createRouteMatrixTests,
    createSupertestProbe,
    deriveRoutes,
    deriveRoutesFromSource,
    mutatingRoutes,
    overrideKey,
    resolvePosture,
    resolveProbePath,
    statusSatisfiesPosture,
};
