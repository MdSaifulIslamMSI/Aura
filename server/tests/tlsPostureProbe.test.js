const path = require('path');
const tls = require('tls');
const { EventEmitter } = require('events');
const {
    PROBE_VERSIONS,
    probeHost,
    probeEdge,
    evaluatePosture,
    loadPostureConfig,
    renderPostureMarkdown,
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
const certificateErrorCodes = [
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'CERT_HAS_EXPIRED',
    'ERR_TLS_CERT_ALTNAME_INVALID',
];

describe('TLS host probing', () => {
    let socket;
    let connect;

    beforeEach(() => {
        jest.useFakeTimers();
        socket = new EventEmitter();
        socket.authorized = true;
        socket.getProtocol = jest.fn();
        socket.setTimeout = jest.fn().mockReturnValue(socket);
        socket.destroy = jest.fn(() => {
            socket.emit('close');
            return socket;
        });
        connect = jest.spyOn(tls, 'connect').mockImplementation((_options, onSecureConnect) => {
            if (onSecureConnect) socket.once('secureConnect', onSecureConnect);
            return socket;
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    const expectCleanup = () => {
        expect(socket.destroy).toHaveBeenCalledTimes(1);
        expect(socket.eventNames()).toEqual([]);
        expect(jest.getTimerCount()).toBe(0);
    };

    test.each(PROBE_VERSIONS)('pins %s with verified certificates and socket-local legacy ciphers', async (version) => {
        const defaultCiphers = tls.DEFAULT_CIPHERS;
        socket.getProtocol.mockReturnValue(version);
        const pending = probeHost('edge.test', version, 50);
        const options = connect.mock.calls[0][0];

        expect(options).toEqual({
            host: 'edge.test',
            port: 443,
            servername: 'edge.test',
            rejectUnauthorized: true,
            minVersion: version,
            maxVersion: version,
            ...(['TLSv1', 'TLSv1.1'].includes(version) ? { ciphers: 'DEFAULT:@SECLEVEL=0' } : {}),
        });
        expect(tls.DEFAULT_CIPHERS).toBe(defaultCiphers);
        socket.emit('secureConnect');
        await expect(pending).resolves.toBe('accepted');
        expectCleanup();
    });

    test.each(PROBE_VERSIONS.flatMap((version) => (
        certificateErrorCodes.map((code) => [version, code])
    )))('keeps %s authorization failure %s inconclusive on secureConnect', async (version, code) => {
        socket.authorized = false;
        socket.authorizationError = code;
        socket.getProtocol.mockReturnValue(version);
        const pending = probeHost('edge.test', version, 50);
        socket.emit('secureConnect');

        await expect(pending).resolves.toBe(`error:${code}`);
        expectCleanup();
    });

    test.each([false, undefined, null, 1, 'true'])('requires authorized === true, not %p, even without an authorization error', async (authorized) => {
        socket.authorized = authorized;
        socket.getProtocol.mockReturnValue('TLSv1.3');
        const pending = probeHost('edge.test', 'TLSv1.3', 50);
        socket.emit('secureConnect');

        await expect(pending).resolves.toBe('unknown');
        expectCleanup();
    });

    test('preserves an authorization error code supplied as an Error object', async () => {
        socket.authorized = false;
        socket.authorizationError = Object.assign(new Error('hostname mismatch'), {
            code: 'ERR_TLS_CERT_ALTNAME_INVALID',
        });
        socket.getProtocol.mockReturnValue('TLSv1.3');
        const pending = probeHost('edge.test', 'TLSv1.3', 50);
        socket.emit('secureConnect');

        await expect(pending).resolves.toBe('error:ERR_TLS_CERT_ALTNAME_INVALID');
        expectCleanup();
    });

    test('recognizes an explicit peer protocol-version alert as rejection', async () => {
        const pending = probeHost('edge.test', 'TLSv1', 50);
        socket.emit('error', Object.assign(new Error('alert 70'), {
            code: 'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION',
        }));

        await expect(pending).resolves.toBe('rejected');
        expectCleanup();
    });

    test.each([
        ...certificateErrorCodes,
        'ERR_SSL_NO_PROTOCOLS_AVAILABLE',
        'ERR_SSL_UNSUPPORTED_PROTOCOL',
        'ERR_SSL_NO_CIPHERS_AVAILABLE',
        'ERR_SSL_LEGACY_SIGALG_DISALLOWED_OR_UNSUPPORTED',
        'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE',
        'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR',
        'ERR_SSL_TLSV1_ALERT_INSUFFICIENT_SECURITY',
        'ENOTFOUND',
        'EAI_AGAIN',
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
    ])('retains async %s as an error, not peer protocol rejection', async (code) => {
        const pending = probeHost('edge.test', 'TLSv1', 50);
        socket.emit('error', Object.assign(new Error('probe failed'), { code }));

        await expect(pending).resolves.toBe(`error:${code}`);
        expectCleanup();
    });

    test.each([
        'ERR_SSL_NO_PROTOCOLS_AVAILABLE',
        'ERR_INVALID_ARG_VALUE',
        'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION',
    ])('catches synchronous %s without claiming a peer response', async (code) => {
        connect.mockImplementation(() => {
            throw Object.assign(new Error('client setup failed'), { code });
        });

        await expect(probeHost('edge.test', 'TLSv1', 50)).resolves.toBe(`error:${code}`);
        expect(socket.destroy).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
    });

    test('does not infer protocol rejection from an error message without an allowed code', async () => {
        const pending = probeHost('edge.test', 'TLSv1', 50);
        socket.emit('error', new Error('tlsv1 alert protocol version, alert number 70'));

        await expect(pending).resolves.toBe('unknown');
        expectCleanup();
    });

    test.each([null, 'TLSv1.2'])('treats unexpected negotiated protocol %s as unknown', async (protocol) => {
        socket.getProtocol.mockReturnValue(protocol);
        const pending = probeHost('edge.test', 'TLSv1.1', 50);
        socket.emit('secureConnect');

        await expect(pending).resolves.toBe('unknown');
        expectCleanup();
    });

    test('settles an unexplained socket close as unknown', async () => {
        const pending = probeHost('edge.test', 'TLSv1', 50);
        socket.emit('close');

        await expect(pending).resolves.toBe('unknown');
        expectCleanup();
    });

    test('bounds the entire probe even if connection or handshake activity continues', async () => {
        const pending = probeHost('edge.test', 'TLSv1', 50);
        jest.advanceTimersByTime(25);
        socket.emit('connect');
        socket.emit('data', Buffer.from('partial handshake'));
        jest.advanceTimersByTime(24);
        expect(socket.destroy).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);

        await expect(pending).resolves.toBe('timeout');
        expectCleanup();
    });

    test.each([undefined, 0, -1, 0.5, NaN, Infinity, 2147483648])(
        'uses a bounded default deadline for timeout %s',
        async (timeoutMs) => {
            const pending = probeHost('edge.test', 'TLSv1', timeoutMs);
            jest.advanceTimersByTime(14999);
            expect(socket.destroy).not.toHaveBeenCalled();
            jest.advanceTimersByTime(1);

            await expect(pending).resolves.toBe('timeout');
            expectCleanup();
        }
    );

    test('keeps an error handler until asynchronous close, then removes probe listeners', async () => {
        socket.destroy.mockReturnValue(socket);
        const pending = probeHost('edge.test', 'TLSv1', 50);
        socket.emit('error', Object.assign(new Error('reset'), { code: 'ECONNRESET' }));

        await expect(pending).resolves.toBe('error:ECONNRESET');
        expect(socket.listenerCount('secureConnect')).toBe(0);
        expect(socket.listenerCount('error')).toBe(1);
        expect(jest.getTimerCount()).toBe(0);
        socket.emit('error', new Error('late error before close'));
        socket.emit('close');
        expectCleanup();
    });

    test('handles an error racing with destruction without changing the settled result', async () => {
        socket.getProtocol.mockReturnValue('TLSv1.3');
        socket.destroy.mockImplementation(() => {
            socket.emit('error', Object.assign(new Error('late reset'), { code: 'ECONNRESET' }));
            socket.emit('close');
            return socket;
        });
        const pending = probeHost('edge.test', 'TLSv1.3', 50);
        socket.emit('secureConnect');

        await expect(pending).resolves.toBe('accepted');
        expectCleanup();
    });
});

describe('production TLS edge posture', () => {
    test('the declared edges record provider ownership', () => {
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
        // This policy permits TLS 1.2 when legacy rejection and TLS 1.3
        // availability are confirmed; minExpected is checked separately.
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

    test.each(['TLSv1', 'TLSv1.1'].flatMap((version) => (
        ['timeout', 'unknown', 'error:ERR_SSL_NO_PROTOCOLS_AVAILABLE', 'error:ENOTFOUND', 'error:ECONNRESET',
            ...certificateErrorCodes.map((code) => `error:${code}`), 'unexpected', undefined]
            .map((outcome) => [version, outcome])
    )))('fails closed for inconclusive %s (%s) despite modern successes', async (version, outcome) => {
        const probe = async (_host, requested) => {
            if (requested === version) return outcome;
            return ['TLSv1.2', 'TLSv1.3'].includes(requested) ? 'accepted' : 'rejected';
        };
        const measured = await probeEdge(edge('edge.test'), { probe });
        const result = evaluatePosture([measured], config());

        expect(measured.minimum).toBe('TLSv1.2');
        expect(measured.tls13Available).toBe(true);
        expect(measured.acceptsLegacy).toBe(false);
        expect(result.status).toBe('fail');
        expect(result.findings).toEqual([expect.objectContaining({
            severity: 'blocker', code: 'legacy_tls_inconclusive', edge: 'edge.test',
        })]);
        expect(result.findings[0].message).toContain(version);
    });

    test('does not treat missing legacy results as proof of rejection', async () => {
        const measured = await probeEdge(edge('edge.test'), {
            probe: fakeProbe({ 'edge.test': ['TLSv1.2', 'TLSv1.3'] }),
        });
        delete measured.results;
        const result = evaluatePosture([measured], config());

        expect(result.status).toBe('fail');
        expect(result.findings.map((f) => f.code)).toContain('legacy_tls_inconclusive');
    });

    test('keeps a declared TLS 1.3 minimum strict', async () => {
        const measured = await probeEdge(edge('edge.test', 'TLSv1.3'), {
            probe: fakeProbe({ 'edge.test': ['TLSv1.2', 'TLSv1.3'] }),
        });
        const result = evaluatePosture([measured], config());

        expect(measured.minExpected).toBe('TLSv1.3');
        expect(result.status).toBe('fail');
        expect(result.findings.map((f) => f.code)).toContain('minimum_regressed');
    });

    test('reports inconclusive legacy probes as unknown, not a confirmed safe floor', async () => {
        const measured = await probeEdge(edge('edge.test'), {
            probe: async (_host, version) => (
                ['TLSv1.2', 'TLSv1.3'].includes(version) ? 'accepted' : 'timeout'
            ),
        });
        const markdown = renderPostureMarkdown(evaluatePosture([measured], config()));

        expect(markdown).toContain('| Lowest accepted TLS |');
        expect(markdown).toContain('| TLSv1.2 | yes | unknown |');
        expect(markdown).toContain('legacy_tls_inconclusive');
        expect(markdown).not.toContain('cannot be changed from this repository');
    });

    test('documents verified acceptance and unauthenticated alert limitations', () => {
        const markdown = renderPostureMarkdown(evaluatePosture([], config()));

        expect(markdown).toContain('Accepted handshakes require certificate-chain and hostname verification.');
        expect(markdown).toContain('Pre-handshake alerts are unauthenticated and do not prove the intended server sent them.');
        expect(markdown).toContain('Certificate, client, and network failures leave legacy checks inconclusive');
        expect(markdown).not.toContain('not certificate trust');
    });

    test('probes versions weakest-first to record the lowest observed acceptance', () => {
        expect(PROBE_VERSIONS).toEqual(['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3']);
    });
});
