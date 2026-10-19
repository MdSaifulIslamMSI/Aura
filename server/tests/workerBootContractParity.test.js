// Regression guard for the worker/API boot-contract parity.
//
// server/index.js (the API) asserts a long list of production configuration
// contracts before it starts listening. server/workerProcess.js used to assert
// only five of them, so the worker could boot — and keep processing payment
// outbox, email, OTP and catalog jobs — on a configuration the API would
// refuse. That is a split-brain deployment: the API fails closed while the
// worker keeps running with the weaker settings.
//
// This test walks BOTH entrypoints and asserts that the worker enforces every
// API contract except the two it documents as not applicable (CORS and
// Turnstile: the worker serves no browser surface). It also asserts that the
// worker runs the contract before it connects to the database, so a
// misconfigured worker never starts doing work.
const fs = require('fs');
const path = require('path');

const SERVER_ROOT = path.resolve(__dirname, '..');
const API_ENTRYPOINT = path.join(SERVER_ROOT, 'index.js');
const WORKER_ENTRYPOINT = path.join(SERVER_ROOT, 'workerProcess.js');

// The API contracts the worker legitimately cannot enforce: the worker only
// exposes its own local health server (no cross-origin browser request, so
// there is no CORS allowlist to protect) and it never validates a Turnstile
// token (Turnstile is a browser challenge).
const DOCUMENTED_WORKER_OMISSIONS = [
    'assertProductionCorsConfig',
    'assertProductionTurnstileConfig',
];

const extractAssertCalls = (source) => {
    const calls = [];
    const pattern = /^[ \t]*(assert[A-Za-z0-9_]*)\(\);[ \t]*$/gm;
    let match = pattern.exec(source);
    while (match) {
        calls.push(match[1]);
        match = pattern.exec(source);
    }
    return calls;
};

const extractFunctionBody = (source, functionName) => {
    const start = source.indexOf(`const ${functionName} = (`);
    if (start === -1) return '';
    const end = source.indexOf('\n};', start);
    if (end === -1) return '';
    return source.slice(start, end);
};

describe('worker boot contract parity with the API', () => {
    const apiSource = fs.readFileSync(API_ENTRYPOINT, 'utf8');
    const workerSource = fs.readFileSync(WORKER_ENTRYPOINT, 'utf8');

    const apiAsserts = extractAssertCalls(apiSource);
    const workerContractBody = extractFunctionBody(workerSource, 'assertWorkerStartupConfig');
    const workerAsserts = extractAssertCalls(workerContractBody);

    test('the API entrypoint still asserts a substantial boot contract', () => {
        expect(apiAsserts.length).toBeGreaterThanOrEqual(20);
        expect(apiAsserts).toContain('assertProductionCorsConfig');
        expect(apiAsserts).toContain('assertProductionTurnstileConfig');
    });

    test('the worker enforces every API boot contract', () => {
        const uncovered = apiAsserts.filter((name) => !workerAsserts.includes(name));

        expect(uncovered).toEqual(DOCUMENTED_WORKER_OMISSIONS);
    });

    test('the worker omits only the two documented browser-surface contracts', () => {
        const extra = workerAsserts.filter((name) => !apiAsserts.includes(name));

        expect(extra).toEqual([]);
        expect(new Set(workerAsserts).size).toBe(workerAsserts.length);
    });

    test('the worker documents each omitted contract in the source', () => {
        for (const omitted of DOCUMENTED_WORKER_OMISSIONS) {
            expect(workerSource).toContain(omitted);
        }
    });

    test('the worker runs the boot contract before it connects to the database', () => {
        const contractIndex = workerSource.indexOf('assertWorkerStartupConfig();');
        const connectIndex = workerSource.indexOf('await connectDB();');

        expect(contractIndex).toBeGreaterThan(-1);
        expect(connectIndex).toBeGreaterThan(-1);
        expect(contractIndex).toBeLessThan(connectIndex);
    });

    test('the worker contract includes the secret-consuming contracts', () => {
        for (const required of [
            'assertCryptoSeparationConfig',
            'assertOtpHashSecretIsolation',
            'assertMfaCryptoConfig',
            'assertAuthVaultConfig',
            'assertFieldEncryptionConfig',
            'assertFieldEncryptionProductionReadiness',
            'assertAuthEnvironmentConfig',
            'assertTrustedDeviceConfig',
            'assertAdminSecurityConfig',
            'assertSigningSecretsConfig',
        ]) {
            expect(workerAsserts).toContain(required);
        }
    });
});
