#!/usr/bin/env node
// Measures negotiated TLS versions at production edges and checks declared policy.
// Certificate/client/network failures are inconclusive, not proof of TLS rejection.
// Remediation controls depend on the TLS terminator and provider configuration;
// hostname ownership alone does not establish which controls are available.
//
// CommonJS on purpose: the server jest suite requires this module directly, and
// the suite's transform does not handle ESM.
//
// Usage:
//   node scripts/security/tls-posture-probe.cjs
//   node scripts/security/tls-posture-probe.cjs --json
//   node scripts/security/tls-posture-probe.cjs --timeout 20000
const fs = require('fs');
const path = require('path');
const tls = require('tls');

const defaultRoot = path.resolve(__dirname, '..', '..');
const CONFIG_RELATIVE = 'config/security/tls-edge-posture.json';

// Ordered weakest first to record the lowest observed acceptance. Inconclusive
// weaker probes prevent that observation from establishing the actual floor.
const PROBE_VERSIONS = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];
const LEGACY_VERSIONS = new Set(['TLSv1', 'TLSv1.1']);
const VERSION_RANK = Object.fromEntries(PROBE_VERSIONS.map((v, i) => [v, i]));
// Only an explicit protocol_version alert (70) counts as reported rejection.
// Pre-handshake alerts are unauthenticated; other failures remain inconclusive.
const PEER_PROTOCOL_REJECTION_CODES = new Set(['ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION']);

// TLS 1.3 hybrid group standardized by IETF/OpenSSL. OpenSSL 3.5 exposes it as
// `X25519MLKEM768`. A pure-group probe distinguishes a server that actually
// selected the hybrid from one that merely tolerated the offer and fell back.
const PQC_HYBRID_GROUP = 'X25519MLKEM768';
const PQC_HYBRID_FALLBACK_GROUP = 'X25519MLKEM768:X25519';

// Certificate-verification failures reported by Node/OpenSSL. A hybrid-group
// handshake that fails on one of these still negotiated the probed group: the
// group is chosen in the ServerHello, which precedes certificate validation.
// Treating them as an unsupported group would blame the key exchange for a
// certificate problem. The version probe below deliberately does NOT use this
// set: there, an unverifiable chain leaves the legacy result inconclusive
// rather than being counted as acceptance.
const CERTIFICATE_ERROR_CODES = new Set([
    'CERT_CHAIN_TOO_LONG',
    'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID',
    'CERT_PATH_LENGTH_EXCEEDED',
    'CERT_REVOKED',
    'CERT_SIGNATURE_FAILURE',
    'CERT_UNTRUSTED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'INVALID_CA',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);

const isCertificateVerificationError = (error) => (
    Boolean(error) && CERTIFICATE_ERROR_CODES.has(String(error.code || ''))
);

const probeErrorResult = (error) => (
    typeof error?.code === 'string' ? `error:${error.code}` : 'unknown'
);
const inconclusiveLegacyVersions = (edge) => [...LEGACY_VERSIONS].filter(
    (version) => !['accepted', 'rejected'].includes(edge.results?.[version])
);

const loadPostureConfig = (root = defaultRoot) => JSON.parse(
    fs.readFileSync(path.join(root, CONFIG_RELATIVE), 'utf8')
);

/** TLS 1.3 handshake restricted to one key-exchange group. */
const probeTls13Group = (host, group, timeoutMs = 15000) => new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
    };
    let socket;
    try {
        socket = tls.connect({
            host,
            port: 443,
            servername: host,
            rejectUnauthorized: true,
            checkServerIdentity: () => undefined,
            minVersion: 'TLSv1.3',
            maxVersion: 'TLSv1.3',
            ecdhCurve: group,
        }, () => {
            const cipher = typeof socket.getCipher === 'function' ? socket.getCipher() : null;
            const ephemeral = typeof socket.getEphemeralKeyInfo === 'function'
                ? socket.getEphemeralKeyInfo()
                : null;
            const protocol = socket.getProtocol();
            socket.destroy();
            finish({
                accepted: true,
                protocol,
                cipher: cipher ? cipher.name : null,
                ephemeral,
            });
        });
    } catch (error) {
        finish({ accepted: false, errorCode: error.code || error.message });
        return;
    }
    socket.setTimeout(timeoutMs, () => {
        socket.destroy();
        finish({ accepted: false, errorCode: 'ETIMEDOUT' });
    });
    socket.on('error', (error) => finish(isCertificateVerificationError(error)
        ? { accepted: true, certificateError: error.code }
        : { accepted: false, errorCode: error.code || error.message }));
});

/**
 * Measure whether an edge actually selects hybrid X25519+ML-KEM-768.
 *
 * A pure `X25519MLKEM768` handshake succeeds only when the server selects the
 * hybrid group. If that fails but the ordered fallback succeeds, the edge
 * offers hybrid but negotiated classical X25519 - a materially different
 * posture that a generic "TLS 1.3 works" check cannot see.
 */
const probeHybridKex = async (host, timeoutMs = 15000) => {
    const pure = await probeTls13Group(host, PQC_HYBRID_GROUP, timeoutMs);
    if (pure.accepted) {
        return {
            status: 'hybrid-accepted',
            group: PQC_HYBRID_GROUP,
            protocol: pure.protocol || null,
            cipher: pure.cipher || null,
        };
    }
    const fallback = await probeTls13Group(host, PQC_HYBRID_FALLBACK_GROUP, timeoutMs);
    if (fallback.accepted) {
        return {
            status: 'classical-fallback',
            group: PQC_HYBRID_FALLBACK_GROUP,
            protocol: fallback.protocol || null,
            cipher: fallback.cipher || null,
            pureGroupError: pure.errorCode || null,
        };
    }
    return {
        status: pure.errorCode === 'ETIMEDOUT' || fallback.errorCode === 'ETIMEDOUT'
            ? 'timeout'
            : 'unsupported',
        group: null,
        protocol: null,
        cipher: null,
        pureGroupError: pure.errorCode || null,
        fallbackError: fallback.errorCode || null,
    };
};

/** Resolves accepted/rejected, timeout, error:<code>, or unknown on local/network failure. */
const probeHost = (host, version, timeoutMs = 15000) => new Promise((resolve) => {
    let settled = false;
    let socket;
    const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        if (socket) {
            socket.removeListener('secureConnect', onSecureConnect);
            socket.destroy();
        }
        resolve(result);
    };
    const onSecureConnect = () => {
        if (socket.authorized !== true) {
            const error = socket.authorizationError;
            finish(probeErrorResult(typeof error === 'string' ? { code: error } : error));
            return;
        }
        finish(socket.getProtocol() === version ? 'accepted' : 'unknown');
    };
    const onError = (error) => finish(
        PEER_PROTOCOL_REJECTION_CODES.has(error?.code) ? 'rejected' : probeErrorResult(error)
    );
    const onClose = () => {
        finish('unknown');
        // Retain the error handler until close: destroy can race a pending error.
        socket.removeListener('error', onError);
    };
    // An absolute deadline also covers DNS/connect stalls and active handshakes,
    // unlike a socket inactivity timeout. Invalid/overflowing delays use the default.
    const delay = Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 2147483647
        ? timeoutMs : 15000;
    const deadline = setTimeout(() => finish('timeout'), delay);
    try {
        socket = tls.connect({
            host,
            port: 443,
            servername: host,
            rejectUnauthorized: true,
            minVersion: version,
            maxVersion: version,
            // OpenSSL's default security level can disable legacy TLS locally.
            // Relax only these diagnostic sockets, never runtime/global defaults.
            ...(LEGACY_VERSIONS.has(version) ? { ciphers: 'DEFAULT:@SECLEVEL=0' } : {}),
        });
        socket.once('secureConnect', onSecureConnect);
        socket.on('error', onError);
        socket.once('close', onClose);
    } catch (error) {
        // A synchronous setup failure cannot be evidence of a peer response.
        finish(probeErrorResult(error));
    }
});

const probeEdge = async (edge, { timeoutMs = 15000, probe = probeHost, pqcProbe } = {}) => {
    const results = {};
    for (const version of PROBE_VERSIONS) {
        results[version] = await probe(edge.host, version, timeoutMs);
    }
    const accepted = PROBE_VERSIONS.filter((v) => results[v] === 'accepted');

    // Existing unit tests inject a classical version probe. They must not hit
    // the network for the PQ leg, so only auto-enable the real hybrid probe
    // when the caller did not substitute the default probe.
    const hybridProbe = pqcProbe !== undefined
        ? pqcProbe
        : (probe === probeHost ? probeHybridKex : null);
    let pqc = {
        status: 'not-probed',
        group: null,
        protocol: null,
        cipher: null,
    };
    if (hybridProbe) {
        try {
            pqc = await hybridProbe(edge.host, timeoutMs);
        } catch (error) {
            pqc = { status: 'error', group: null, error: error?.message || 'unknown' };
        }
    }

    return {
        label: edge.label,
        host: edge.host,
        provider: edge.provider,
        // Must be carried through: probeEdge returns a NEW object, so without
        // this the declared expectation is dropped and the regression check in
        // evaluatePosture becomes unreachable.
        minExpected: edge.minExpected,
        pqcHybridKexExpected: edge.pqcHybridKexExpected === true,
        results,
        accepted,
        minimum: accepted[0] || null,
        acceptsLegacy: accepted.some((v) => LEGACY_VERSIONS.has(v)),
        tls13Available: accepted.includes('TLSv1.3'),
        pqcKex: pqc.status,
        pqcGroup: pqc.group || null,
        pqc,
    };
};

/**
 * Pure verdict function, kept separate from the network so the rules are
 * unit-testable without reaching the internet.
 */
const evaluatePosture = (edges, config) => {
    const requirements = config.requirements || {};
    const findings = [];

    for (const edge of edges) {
        if (requirements.rejectLegacyTls && edge.acceptsLegacy) {
            const legacy = edge.accepted.filter((v) => LEGACY_VERSIONS.has(v));
            findings.push({
                severity: 'blocker',
                code: 'legacy_tls_accepted',
                edge: edge.host,
                message: `${edge.host} accepts legacy TLS (${legacy.join(', ')}), contrary to policy. Remediation is required at the TLS-terminating edge.`,
            });
        }

        const inconclusiveLegacy = inconclusiveLegacyVersions(edge);
        if (requirements.rejectLegacyTls && inconclusiveLegacy.length) {
            findings.push({
                severity: 'blocker',
                code: 'legacy_tls_inconclusive',
                edge: edge.host,
                message: `${edge.host} legacy TLS checks are inconclusive (${inconclusiveLegacy.map((v) => `${v}: ${edge.results?.[v] ?? 'unknown'}`).join(', ')}). Certificate/client/network failures do not prove the peer rejects legacy TLS.`,
            });
        }

        if (requirements.requireTls13Available && !edge.tls13Available) {
            findings.push({
                severity: 'blocker',
                code: 'tls13_unavailable',
                edge: edge.host,
                message: `${edge.host} TLS 1.3 availability was not confirmed (probe: ${edge.results?.['TLSv1.3'] ?? 'unknown'}).`,
            });
        }

        // Acceptance below the declared minimum is a regression, even if other
        // probes are inconclusive. Rank rises with protocol strength.
        if (edge.minExpected && edge.minimum && VERSION_RANK[edge.minimum] < VERSION_RANK[edge.minExpected]) {
            findings.push({
                severity: 'blocker',
                code: 'minimum_regressed',
                edge: edge.host,
                message: `${edge.host} accepts ${edge.minimum}, weaker than the expected minimum ${edge.minExpected}.`,
            });
        } else if (edge.minExpected && edge.minimum && edge.minimum !== edge.minExpected) {
            findings.push({
                severity: 'info',
                code: 'minimum_stronger_than_expected',
                edge: edge.host,
                message: `${edge.host} lowest observed acceptance is ${edge.minimum}, stronger than the expected ${edge.minExpected}; inconclusive weaker probes may still prevent establishing the floor.`,
            });
        }

        if (requirements.requirePqcHybridKex && edge.pqcKex !== 'hybrid-accepted') {
            findings.push({
                severity: 'blocker',
                code: 'pqc_hybrid_kex_unavailable',
                edge: edge.host,
                message: `${edge.host} did not select hybrid X25519+ML-KEM-768 (measured: ${edge.pqcKex}).`,
            });
        } else if (edge.pqcHybridKexExpected && edge.pqcKex === 'classical-fallback') {
            findings.push({
                severity: 'warning',
                code: 'pqc_hybrid_kex_fallback',
                edge: edge.host,
                message: `${edge.host} offers hybrid X25519+ML-KEM-768 but negotiated the classical X25519 fallback. Provider-side group preference, not an application regression.`,
            });
        } else if (edge.pqcHybridKexExpected && edge.pqcKex === 'unsupported') {
            findings.push({
                severity: 'warning',
                code: 'pqc_hybrid_kex_unsupported',
                edge: edge.host,
                message: `${edge.host} did not accept hybrid X25519+ML-KEM-768. Re-check after the next provider TLS change.`,
            });
        }
    }

    const blockers = findings.filter((f) => f.severity === 'blocker');
    return {
        status: blockers.length > 0 ? 'fail' : 'pass',
        summary: {
            edges: edges.length,
            blockers: blockers.length,
            legacyTlsEdges: edges.filter((e) => e.acceptsLegacy).length,
            tls13Available: edges.filter((e) => e.tls13Available).length,
            pqcHybridEdges: edges.filter((e) => e.pqcKex === 'hybrid-accepted').length,
            pqcFallbackEdges: edges.filter((e) => e.pqcKex === 'classical-fallback').length,
            pqcNotProbedEdges: edges.filter((e) => e.pqcKex === 'not-probed').length,
        },
        findings,
        edges,
    };
};

const renderPostureMarkdown = (result) => {
    const lines = [
        '# Production TLS edge posture (measured)',
        '',
        `Status: **${result.status}**`,
        '',
        'Accepted handshakes require certificate-chain and hostname verification.',
        'This probe measures negotiated TLS versions, not HTTP behavior.',
        'Only an explicit protocol-version alert counts as rejection.',
        'Pre-handshake alerts are unauthenticated and do not prove the intended server sent them.',
        'Certificate, client, and network failures leave legacy checks inconclusive and fail the legacy-rejection gate.',
        'The lowest accepted version is an observation, not an authenticated proof of the edge\'s protocol floor.',
        'Remediation controls depend on the TLS terminator and provider configuration,',
        'not hostname ownership alone.',
        '',
        `- Edges measured: ${result.summary.edges}`,
        `- TLS 1.3 available: ${result.summary.tls13Available}/${result.summary.edges}`,
        `- PQ hybrid KEX selected: ${result.summary.pqcHybridEdges}/${result.summary.edges} (classical fallback: ${result.summary.pqcFallbackEdges}, not measured: ${result.summary.pqcNotProbedEdges})`,
        `- Edges accepting legacy TLS: ${result.summary.legacyTlsEdges}`,
        '',
        '| Edge | Host | Provider | Lowest accepted TLS | TLS 1.3 | Legacy TLS |',
        '| --- | --- | --- | --- | --- | --- |',
    ];
    for (const edge of result.edges) {
        const legacy = edge.acceptsLegacy ? '**YES**' : inconclusiveLegacyVersions(edge).length ? 'unknown' : 'no';
        lines.push(`| ${edge.label} | \`${edge.host}\` | ${edge.provider} | ${edge.minimum || 'none observed'} | ${edge.tls13Available ? 'yes' : 'not confirmed'} | ${legacy} |`);
    }
    lines.push('');
    if (result.findings.length) {
        lines.push('## Findings', '');
        for (const f of result.findings) {
            lines.push(`- \`${f.severity}\` **${f.code}** — ${f.message}`);
        }
        lines.push('');
    }
    return `${lines.join('\n')}\n`;
};

const runPostureProbe = async ({ root = defaultRoot, timeoutMs = 15000, probe = probeHost, pqcProbe } = {}) => {
    const config = loadPostureConfig(root);
    const edges = [];
    for (const edge of config.edges || []) {
        edges.push(await probeEdge(edge, { timeoutMs, probe, pqcProbe }));
    }
    return { config, ...evaluatePosture(edges, config) };
};

const main = async () => {
    const argv = process.argv.slice(2);
    const timeoutIdx = argv.indexOf('--timeout');
    const timeoutMs = timeoutIdx >= 0 ? Number(argv[timeoutIdx + 1]) : 15000;

    const result = await runPostureProbe({ root: defaultRoot, timeoutMs });

    const reportDir = path.join(defaultRoot, 'reports', 'security');
    fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'tls-edge-posture.json'), `${JSON.stringify(result, null, 2)}\n`);
    fs.writeFileSync(path.join(reportDir, 'tls-edge-posture.md'), renderPostureMarkdown(result));

    for (const edge of result.edges) {
        const legacy = edge.acceptsLegacy ? '  **LEGACY TLS ACCEPTED**'
            : inconclusiveLegacyVersions(edge).length ? '  **LEGACY TLS INCONCLUSIVE**' : '';
        console.log(`  ${edge.host.padEnd(46)} lowestAccepted=${String(edge.minimum || 'none observed').padEnd(8)} tls13=${edge.tls13Available ? 'yes ' : 'not confirmed'} pqc-kex=${String(edge.pqcKex || 'not-probed').padEnd(18)}${legacy}`);
    }
    console.log(`[tls-edge-posture] ${result.status}: ${result.summary.edges} edge(s), ${result.summary.tls13Available} with TLS 1.3, ${result.summary.pqcHybridEdges} selecting hybrid PQ KEX, ${result.summary.pqcFallbackEdges} classical fallback, ${result.summary.legacyTlsEdges} accepting legacy TLS, ${result.summary.blockers} blocker(s).`);
    if (result.status === 'fail') process.exit(1);
};

if (require.main === module) {
    main().catch((error) => {
        console.error(`[tls-edge-posture] ${error.message}`);
        process.exit(2);
    });
}

module.exports = {
    PROBE_VERSIONS,
    LEGACY_VERSIONS,
    PQC_HYBRID_GROUP,
    PQC_HYBRID_FALLBACK_GROUP,
    probeHost,
    probeTls13Group,
    probeHybridKex,
    probeEdge,
    evaluatePosture,
    loadPostureConfig,
    renderPostureMarkdown,
    runPostureProbe,
};
