const {
    getStudentPackSecurityHarnessSnapshot,
    shouldExposeStudentPackSecurityHarness,
    __testables,
} = require('../services/studentPackSecurityHarnessService');

const HARNESS_ENV_KEYS = [
    'STUDENT_PACK_SECURITY_HARNESS_ENABLED',
    'STUDENT_PACK_SECURITY_HARNESS_PUBLIC',
    'STUDENT_PACK_SECURITY_HARNESS_PROBE_ENDPOINTS',
    'DOPPLER_TOKEN',
    'DOPPLER_PROJECT',
    'DOPPLER_CONFIG',
    'SENTRY_DSN',
    'SENTRY_AUTH_TOKEN',
    'SENTRY_ORG',
    'SENTRY_PROJECT',
    'DATADOG_API_KEY',
    'DD_API_KEY',
    'TESTMAIL_APIKEY',
    'TESTMAIL_NAMESPACE',
    'LT_USERNAME',
    'LT_ACCESS_KEY',
    'LAMBDATEST_ACCESS_KEY',
    'LOCALSTACK_AUTH_TOKEN',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'STUDENT_PACK_LIVE_AUTH_REPORT_PATH',
];

describe('studentPackSecurityHarnessService', () => {
    const originalEnv = {};
    const originalNodeEnv = process.env.NODE_ENV;

    beforeEach(() => {
        HARNESS_ENV_KEYS.forEach((key) => {
            originalEnv[key] = process.env[key];
            delete process.env[key];
        });
        process.env.NODE_ENV = 'test';
        process.env.STUDENT_PACK_LIVE_AUTH_REPORT_PATH = '__missing_live_auth_report__.json';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        HARNESS_ENV_KEYS.forEach((key) => {
            if (originalEnv[key] === undefined) delete process.env[key];
            else process.env[key] = originalEnv[key];
        });
    });

    test('keeps production public harness disabled unless explicitly enabled', () => {
        process.env.NODE_ENV = 'production';
        process.env.STUDENT_PACK_SECURITY_HARNESS_ENABLED = 'true';

        expect(shouldExposeStudentPackSecurityHarness()).toBe(false);

        process.env.STUDENT_PACK_SECURITY_HARNESS_PUBLIC = 'true';
        expect(shouldExposeStudentPackSecurityHarness()).toBe(true);
    });

    test('reports provider readiness without exposing secret values', async () => {
        process.env.DATADOG_API_KEY = 'dd-secret-value';
        process.env.TESTMAIL_APIKEY = 'testmail-secret-value';
        process.env.LT_ACCESS_KEY = 'lambda-secret-value';
        process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/123';

        const snapshot = await getStudentPackSecurityHarnessSnapshot({ probeEndpoints: false });
        const serialized = JSON.stringify(snapshot);
        const datadog = snapshot.providers.find((provider) => provider.id === 'datadog');
        const testmail = snapshot.providers.find((provider) => provider.id === 'testmail');
        const lambdaTest = snapshot.providers.find((provider) => provider.id === 'lambdatest');

        expect(datadog.status).toBe('ready');
        expect(testmail.status).toBe('partial');
        expect(testmail.missingEnv).toContain('TESTMAIL_NAMESPACE');
        expect(lambdaTest.status).toBe('partial');
        expect(lambdaTest.missingEnv).toContain('LT_USERNAME');
        expect(serialized).not.toContain('dd-secret-value');
        expect(serialized).not.toContain('testmail-secret-value');
        expect(serialized).not.toContain('lambda-secret-value');
    });

    test('builds advanced control and gated-flow matrices from provider readiness', async () => {
        process.env.DATADOG_API_KEY = 'dd-secret-value';
        process.env.TESTMAIL_APIKEY = 'testmail-secret-value';
        process.env.TESTMAIL_NAMESPACE = 'mailbox';
        process.env.LT_USERNAME = 'lambda-user';
        process.env.LT_ACCESS_KEY = 'lambda-secret-value';
        process.env.SENTRY_DSN = 'https://public@example.ingest.sentry.io/123';
        process.env.SENTRY_AUTH_TOKEN = 'sentry-secret-value';
        process.env.SENTRY_ORG = 'aura';
        process.env.SENTRY_PROJECT = 'web';
        process.env.DOPPLER_TOKEN = 'doppler-secret-value';

        const snapshot = await getStudentPackSecurityHarnessSnapshot({ probeEndpoints: false });
        const control = snapshot.controls.find((entry) => entry.id === 'release-error-loop');
        const flow = snapshot.gatedFlows.find((entry) => entry.id === 'auth-critical');

        expect(control).toMatchObject({
            name: 'Release error loop',
            status: 'ready',
            readinessPercent: 100,
        });
        expect(flow).toMatchObject({
            name: 'Auth critical path',
            status: 'ready',
        });
        expect(snapshot.nextActions.length).toBeGreaterThan(0);
        expect(__testables.buildControlMatrix(snapshot.providers).length).toBeGreaterThan(0);
        expect(JSON.stringify(snapshot)).not.toContain('sentry-secret-value');
        expect(JSON.stringify(snapshot)).not.toContain('doppler-secret-value');
    });
});
