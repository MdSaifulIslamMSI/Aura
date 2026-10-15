const path = require('path');
const {
    PROBE_VERSIONS,
    probeEdge,
    evaluatePosture,
    loadPostureConfig,
} = require('../../scripts/security/tls-posture-probe.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');

// Builds a fake probe from a map of host -> set of accepted versions.
const fakeProbe = (acceptedByHost) => async (host, version) => (
    (acceptedByHost[host] || []).includes(version) ? 'accepted' : 'rejected'
);

const config = () => loadPostureConfig(repoRoot);
const edge = (host, minExpected = 'TLSv1.2') => ({
    label: host, host, provider: 'test', minExpected,
});

describe('production TLS edge posture', () => {
    test('the declared edges are all provider-owned, never a domain we control', () => {
        // A custom certificate is the only way to change a viewer minimum, and
        // ACM needs DNS control of the domain. If a project-owned domain ever
        // appears here, this assertion should be revisited deliberately rather
        // than flipped silently.
        for (const e of config().edges) {
            expect(e.owner).toBe('provider');
        }
        expect(config().edges.length).toBeGreaterThan(0);
    });

    test('passes when every edge is TLS 1.2+ with 1.3 available', async () => {
        const good = { 'edge.test': ['TLSv1.2', 'TLSv1.3'] };
        const measured = await probeEdge(edge('edge.test'), { probe: fakeProbe(good) });
        const result = evaluatePosture([measured], config());

        expect(result.status).toBe('pass');
        expect(measured.minimum).toBe('TLSv1.2');
        expect(measured.tls13Available).toBe(true);
        expect(result.summary.blockers).toBe(0);
    });

    test('fails an edge that accepts legacy TLS', async () => {
        // The one failure this repo can legitimately be held to.
        const legacy = { 'edge.test': ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'] };
        const measured = await probeEdge(edge('edge.test'), { probe: fakeProbe(legacy) });
        const result = evaluatePosture([measured], config());

        expect(result.status).toBe('fail');
        const codes = result.findings.map((f) => f.code);
        expect(codes).toContain('legacy_tls_accepted');
        expect(result.findings.find((f) => f.code === 'legacy_tls_accepted').severity).toBe('blocker');
    });

    test('fails an edge with no TLS 1.3', async () => {
        const no13 = { 'edge.test': ['TLSv1.2'] };
        const measured = await probeEdge(edge('edge.test'), { probe: fakeProbe(no13) });
        const result = evaluatePosture([measured], config());

        expect(result.status).toBe('fail');
        expect(result.findings.map((f) => f.code)).toContain('tls13_unavailable');
    });

    test('fails an edge whose floor regressed below the declared minimum', async () => {
        const weak = { 'edge.test': ['TLSv1.1', 'TLSv1.2', 'TLSv1.3'] };
        const measured = await probeEdge(edge('edge.test', 'TLSv1.2'), { probe: fakeProbe(weak) });
        const result = evaluatePosture([measured], config());

        expect(result.status).toBe('fail');
        expect(result.findings.map((f) => f.code)).toContain('minimum_regressed');
    });

    test('does NOT fail merely because the floor is 1.2 rather than 1.3', () => {
        // The whole point. A TLS 1.3 minimum is not enforceable on a
        // provider-owned hostname, so demanding one would be a gate no real edge
        // could ever satisfy - the same silent-pass as skipping it entirely.
        const measured = {
            label: 'edge.test', host: 'edge.test', provider: 'test',
            results: {
                TLSv1: 'rejected', 'TLSv1.1': 'rejected', 'TLSv1.2': 'accepted', 'TLSv1.3': 'accepted',
            },
            accepted: ['TLSv1.2', 'TLSv1.3'], minimum: 'TLSv1.2',
            acceptsLegacy: false, tls13Available: true,
        };
        const result = evaluatePosture([measured], config());

        expect(result.status).toBe('pass');
        expect(result.findings).toHaveLength(0);
    });

    test('treats a timeouts-only host as failing rather than silently passing', async () => {
        const dead = async () => 'timeout';
        const measured = await probeEdge(edge('edge.test'), { probe: dead, timeoutMs: 50 });
        const result = evaluatePosture([measured], config());

        expect(measured.tls13Available).toBe(false);
        expect(result.status).toBe('fail');
    });

    test('probes versions weakest-first so the first hit is the true minimum', () => {
        expect(PROBE_VERSIONS).toEqual(['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3']);
    });
});
