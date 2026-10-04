// Route-security matrix gate (audit 2026-06-01 "fix this month" item).
//
// The derivation/probe machinery lives in packages/route-security-matrix
// (@aurasec/route-security-matrix — published from this repo); this file is
// the thin Jest consumer. Posture data (mounts, postures, overrides) lives in
// server/config/routeSecurityMatrix.js — a new route cannot merge without a
// posture decision recorded there, not here.

const path = require('path');

const { createRouteMatrixTests } = require('../../packages/route-security-matrix');
const matrixConfig = require('../config/routeSecurityMatrix');

const previousTrafficFortressEnabled = process.env.TRAFFIC_FORTRESS_ENABLED;
process.env.TRAFFIC_FORTRESS_ENABLED = 'false';

const app = require('../index');

afterAll(() => {
    if (previousTrafficFortressEnabled === undefined) {
        delete process.env.TRAFFIC_FORTRESS_ENABLED;
    } else {
        process.env.TRAFFIC_FORTRESS_ENABLED = previousTrafficFortressEnabled;
    }
});

createRouteMatrixTests(
    { describe, test, expect, afterAll, setTimeout: (ms) => jest.setTimeout(ms) },
    {
        app,
        request: require('supertest'),
        routesDir: path.join(__dirname, '..', 'routes'),
        indexFile: path.join(__dirname, '..', 'index.js'),
        declarationHint: 'server/config/routeSecurityMatrix.js',
        ...matrixConfig,
    },
);
