const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const supertest = require('supertest');
const { join } = require('node:path');
const { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');

const {
    POSTURES,
    checkMountDrift,
    createRouteMatrixTests,
    deriveRoutes,
    deriveRoutesFromSource,
    mutatingRoutes,
    resolvePosture,
    resolveProbePath,
    statusSatisfiesPosture,
} = require('..');

const fixtureDir = (...parts) => join(__dirname, '..', 'fixtures', ...parts);

// A minimal stand-in for a real test framework: records tests instead of
// running them through Jest, so the factory's registered suite can be
// executed and its failures inspected.
const createRuntimeShim = () => {
    const tests = [];
    const afterAllFns = [];
    const expect = (actual) => ({
        toBe: (expected) => {
            if (actual !== expected) throw new Error(`expected ${expected}, observed ${actual}`);
        },
        toEqual: (expected) => assert.deepStrictEqual(actual, expected),
        toHaveLength: (expected) => assert.strictEqual(actual.length, expected),
    });
    const runtime = {
        describe: (_name, fn) => fn(),
        test: (name, fn) => tests.push({ name, fn }),
        expect,
        afterAll: (fn) => afterAllFns.push(fn),
    };
    return { runtime, tests, afterAllFns };
};

const runSuite = async (config) => {
    const shim = createRuntimeShim();
    createRouteMatrixTests(shim.runtime, config);
    const failures = [];
    for (const { name, fn } of shim.tests) {
        try {
            await fn();
        } catch (error) {
            failures.push({ name, error });
        }
    }
    return { shim, failures };
};

const fixtureMountPrefixes = {
    thingsRoutes: ['/api/things'],
    adminThingsRoutes: ['/api/admin/things'],
    openRoutes: ['/api/open'],
    hookRoutes: ['/api/hooks'],
    mixedRoutes: ['/api/mixed'],
};

const fixtureRoutePostures = {
    thingsRoutes: 'auth',
    adminThingsRoutes: 'admin',
    openRoutes: 'public',
    hookRoutes: 'webhook',
    mixedRoutes: 'public',
};

const fixtureRoutePostureOverrides = {
    'POST /api/mixed/otp': 'preauth',
    // Fixture-only exclusion: the 500ing route exists so the failure-path test
    // can demonstrate a public-posture violation; the clean suite skips it.
    'POST /api/mixed/boom': 'skip',
};

const buildFixtureApp = () => {
    const app = express();
    app.post('/api/things', (_req, res) => res.status(401).json({ error: 'auth required' }));
    app.post('/api/things/:id/adopt', (_req, res) => res.status(401).json({ error: 'auth required' }));
    app.post('/api/admin/things', (_req, res) => res.status(403).json({ error: 'admin required' }));
    app.post('/api/open/ping', (_req, res) => res.json({ ok: true }));
    app.post('/api/hooks/receiver', (_req, res) => res.status(401).json({ error: 'signature required' }));
    app.post('/api/mixed/otp', (_req, res) => res.status(400).json({ error: 'validation failed' }));
    app.post('/api/mixed/boom', (_req, res) => res.status(500).json({ error: 'unexpected' }));
    return app;
};

// ---------------------------------------------------------------- derivation

test('deriveRoutesFromSource: extracts literal route declarations', () => {
    const source = [
        "router.post('/a', handler);",
        "router.patch('/b/:id', handler);",
        'router.put("/c", handler);',
        'router.delete(`/d`, handler);',
        'router.get(`/e`, handler);',
        'router.post(`/dynamic/${expr}`, handler);', // captured raw, not evaluated
    ].join('\n');
    assert.deepEqual(deriveRoutesFromSource(source), [
        { method: 'POST', routePath: '/a' },
        { method: 'PATCH', routePath: '/b/:id' },
        { method: 'PUT', routePath: '/c' },
        { method: 'DELETE', routePath: '/d' },
        { method: 'GET', routePath: '/e' },
        { method: 'POST', routePath: '/dynamic/${expr}' },
    ]);
});

test('deriveRoutes: expands mount prefixes and skips unmounted files', () => {
    const routes = deriveRoutes({
        routesDir: fixtureDir('routes'),
        mountPrefixes: { thingsRoutes: ['/api/things'] },
        fsImpl: { readFileSync, readdirSync },
    });
    assert.deepEqual(routes, [
        { file: 'thingsRoutes', method: 'POST', routePath: '/', path: '/api/things/' },
        { file: 'thingsRoutes', method: 'POST', routePath: '/:id/adopt', path: '/api/things/:id/adopt' },
        { file: 'thingsRoutes', method: 'GET', routePath: '/', path: '/api/things/' },
    ]);
});

test('mutatingRoutes: keeps only state-changing methods', () => {
    const routes = [
        { method: 'GET', routePath: '/', path: '/' },
        { method: 'POST', routePath: '/', path: '/' },
        { method: 'DELETE', routePath: '/x', path: '/x' },
    ];
    assert.deepEqual(mutatingRoutes(routes).map((r) => r.method), ['POST', 'DELETE']);
});

// ---------------------------------------------------------------- posture

test('resolvePosture: override beats file default beats undeclared', () => {
    const route = { file: 'mixedRoutes', method: 'POST', path: '/api/mixed/otp' };
    assert.equal(resolvePosture(route, { routePostures: { mixedRoutes: 'public' }, routePostureOverrides: { 'POST /api/mixed/otp': 'preauth' } }), 'preauth');
    assert.equal(resolvePosture({ file: 'mixedRoutes', method: 'POST', path: '/api/mixed/other' }, { routePostures: { mixedRoutes: 'public' } }), 'public');
    assert.equal(resolvePosture({ file: 'ghost', method: 'POST', path: '/x' }, {}), 'undeclared');
});

test('statusSatisfiesPosture: auth/admin accept 401, 403 and fail-closed 503 only', () => {
    for (const posture of ['auth', 'admin']) {
        assert.ok(statusSatisfiesPosture(401, posture));
        assert.ok(statusSatisfiesPosture(403, posture));
        assert.ok(statusSatisfiesPosture(503, posture), '503 is deliberate fail-closed');
        assert.ok(!statusSatisfiesPosture(400, posture));
        assert.ok(!statusSatisfiesPosture(200, posture));
        assert.ok(!statusSatisfiesPosture(500, posture));
    }
});

test('statusSatisfiesPosture: guarded-open postures accept 4xx and 503, never 5xx leaks', () => {
    for (const posture of ['webhook', 'preauth', 'signed-assertion']) {
        assert.ok(statusSatisfiesPosture(400, posture));
        assert.ok(statusSatisfiesPosture(503, posture));
        assert.ok(!statusSatisfiesPosture(500, posture));
    }
    for (const posture of ['public', 'env-gated-public']) {
        assert.ok(statusSatisfiesPosture(200, posture));
        assert.ok(statusSatisfiesPosture(404, posture));
        assert.ok(statusSatisfiesPosture(503, posture));
        assert.ok(!statusSatisfiesPosture(500, posture));
    }
});

test('POSTURES enum is closed', () => {
    assert.deepEqual(POSTURES, ['auth', 'admin', 'public', 'preauth', 'env-gated-public', 'signed-assertion', 'webhook', 'skip']);
});

test('resolveProbePath: param segments are substituted', () => {
    assert.equal(resolveProbePath('/api/things/:id/adopt'), '/api/things/507f1f77bcf86cd799439011/adopt');
    assert.equal(resolveProbePath('/a/:one/b/:two', 'X'), '/a/X/b/X');
});

// ---------------------------------------------------------------- drift

test('checkMountDrift: detects untracked and stale mounts, honors exemptions', () => {
    const indexSource = [
        "app.use('/api/things', thingsRoutes)",
        "app.use('/api/new', newlyAddedRoutes)",
        "app.use('/api/admin', someMiddleware)", // not a route file
    ].join('\n');
    const result = checkMountDrift({
        indexSource,
        mountPrefixes: { thingsRoutes: ['/api/things'], removedRoutes: ['/api/removed'], metricsRoute: ['/metrics'] },
        variableMountRouters: ['removedRoutes', 'metricsRoute'],
    });
    assert.deepEqual(result, { untracked: ['newlyAddedRoutes'], stale: [] });
});

// ---------------------------------------------------------------- factory

const factoryConfig = () => ({
    app: buildFixtureApp(),
    request: supertest,
    routesDir: fixtureDir('routes'),
    mountPrefixes: fixtureMountPrefixes,
    routePostures: fixtureRoutePostures,
    routePostureOverrides: fixtureRoutePostureOverrides,
});

test('factory: clean fixture app passes every registered test', async () => {
    const { failures, shim } = await runSuite(factoryConfig());
    assert.deepEqual(failures, [], JSON.stringify(failures?.map((f) => f.error?.message)));
    const probeTests = shim.tests.filter((t) => /rejects or safely handles unauthenticated requests/.test(t.name));
    assert.equal(probeTests.length, 7, 'every mutating derived route is probed');
});

test('factory: a 5xx on a public posture fails the behavior test', async () => {
    const config = factoryConfig();
    // Declare boom public-and-healthy; the fixture app 500s on it.
    const { failures } = await runSuite({
        ...config,
        mountPrefixes: { mixedRoutes: ['/api/mixed'] },
        routePostures: { mixedRoutes: 'public' },
        routePostureOverrides: { 'POST /api/mixed/otp': 'public' },
    });
    const behaviorFailures = failures.filter((f) => f.name.includes('POST /api/mixed/boom'));
    assert.equal(behaviorFailures.length, 1);
    assert.match(behaviorFailures[0].error.message, /expected true, observed false/);
});

test('factory: an undeclared route fails coverage with the declaration hint', async () => {
    const { failures } = await runSuite({
        app: buildFixtureApp(),
        request: supertest,
        routesDir: fixtureDir('routes'),
        mountPrefixes: { mixedRoutes: ['/api/mixed'] },
        routePostures: {},
        routePostureOverrides: {},
        declarationHint: 'server/config/routeSecurityMatrix.js',
    });
    const coverageFailure = failures.find((f) => f.name.includes('declared in the security posture inventory'));
    assert.ok(coverageFailure, 'coverage test failed');
    assert.match(coverageFailure.error.message, /POST \/api\/mixed\/boom \(mixedRoutes\.js\)/);
    assert.match(coverageFailure.error.message, /add a posture in server\/config\/routeSecurityMatrix\.js/);
});

test('factory: mount drift between indexFile and config fails the drift test', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rsm-'));
    const indexFile = join(tmp, 'index.js');
    writeFileSync(indexFile, "app.use('/api/mixed', mixedRoutes)\napp.use('/api/new', newRoutes)\n");
    try {
        const { failures } = await runSuite({ ...factoryConfig(), indexFile });
        const driftFailure = failures.find((f) => f.name.includes('mount prefixes cover every mounted route file'));
        assert.ok(driftFailure, 'drift test failed');
        assert.match(driftFailure.error.message, /untracked: newRoutes/);
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
});

test('factory: report dump writes derived routes with observed statuses', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'rsm-'));
    const reportPath = join(tmp, 'nested', 'report.json');
    const config = { ...factoryConfig(), reportPath };
    const { shim } = await runSuite(config);
    for (const fn of shim.afterAllFns) await fn();
    try {
        const report = JSON.parse(readFileSync(reportPath, 'utf8'));
        const boom = report.find((entry) => entry.path === '/api/mixed/boom');
        assert.equal(boom.posture, 'skip');
        const otp = report.find((entry) => entry.path === '/api/mixed/otp');
        assert.equal(otp.posture, 'preauth');
        assert.equal(otp.observedStatus, 400);
        assert.ok(report.every((entry) => entry.file && entry.method && typeof entry.observedStatus === 'number'));
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
});

test('factory: missing required config throws immediately', () => {
    assert.throws(() => createRouteMatrixTests(createRuntimeShim().runtime, {}), /requires app, request, routesDir and mountPrefixes/);
});

test('factory: a misspelled posture fails construction instead of weakening probes', () => {
    assert.throws(
        () => createRouteMatrixTests(
            createRuntimeShim().runtime,
            { ...factoryConfig(), routePostures: { mixedRoutes: 'adimn' } },
        ),
        /unknown posture "adimn"/,
    );
    assert.throws(
        () => createRouteMatrixTests(
            createRuntimeShim().runtime,
            { ...factoryConfig(), routePostureOverrides: { 'POST /api/mixed/otp': 'pubic' } },
        ),
        /unknown posture "pubic"/,
    );
});
