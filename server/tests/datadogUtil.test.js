// Unit tests for server/utils/datadog.js.
// The dd-trace SDK is injected via initDatadog's tracerLoader hook so init
// paths are verified without opening tracer handles or touching the network.
const datadog = require('../utils/datadog');

describe('datadog util config', () => {
    const savedEnv = { ...process.env };

    const setEnv = (overrides) => {
        delete process.env.DATADOG_API_KEY;
        delete process.env.DD_API_KEY;
        delete process.env.DD_ENABLED;
        delete process.env.DATADOG_ENABLED;
        delete process.env.DD_SITE;
        delete process.env.DATADOG_SITE;
        delete process.env.DD_SERVICE;
        delete process.env.DD_ENV;
        delete process.env.DD_VERSION;
        delete process.env.DD_TRACES_SAMPLE_RATE;
        delete process.env.DD_PROFILING_ENABLED;
        delete process.env.DD_LOGS_ENABLED;
        Object.assign(process.env, overrides);
    };

    beforeEach(() => {
        datadog.resetDatadogForTests();
    });

    afterEach(() => {
        datadog.resetDatadogForTests();
        process.env = { ...savedEnv };
    });

    test('stays disabled without an API key and never loads the tracer', () => {
        const loader = jest.fn();
        setEnv({ NODE_ENV: 'production' });
        const config = datadog.resolveDatadogConfig();
        expect(config.enabled).toBe(false);
        expect(config.apiKeyConfigured).toBe(false);

        const state = datadog.initDatadog(process.env, { tracerLoader: loader });
        expect(state).toEqual({ enabled: false, apiKeyConfigured: false, tracerLoaded: false });
        expect(datadog.isDatadogEnabled()).toBe(false);
        expect(loader).not.toHaveBeenCalled();
    });

    test('stays disabled in test env unless explicitly enabled', () => {
        setEnv({ NODE_ENV: 'test', DATADOG_API_KEY: 'dummy-key' });
        expect(datadog.resolveDatadogConfig().enabled).toBe(false);

        setEnv({ NODE_ENV: 'test', DATADOG_API_KEY: 'dummy-key', DD_ENABLED: '1' });
        expect(datadog.resolveDatadogConfig().enabled).toBe(true);
    });

    test('honors the kill switch and resolves site/service/version defaults', () => {
        setEnv({ NODE_ENV: 'production', DATADOG_API_KEY: 'dummy-key', DD_ENABLED: 'off' });
        const killed = datadog.resolveDatadogConfig();
        expect(killed.enabled).toBe(false);
        expect(killed.tracesSampleRate).toBe(0);

        setEnv({ NODE_ENV: 'production', DATADOG_API_KEY: 'dummy-key' });
        expect(datadog.resolveDatadogConfig()).toMatchObject({
            enabled: true,
            site: 'datadoghq.com',
            service: 'aura-marketplace-api',
            environment: 'production',
            version: 'server-unknown',
            tracesSampleRate: 0.1,
        });

        setEnv({
            NODE_ENV: 'production',
            DD_API_KEY: 'dummy-key',
            DD_SITE: 'datadoghq.eu',
            DD_SERVICE: 'custom-service',
            DD_ENV: 'staging',
            DD_VERSION: 'v1.2.3',
            DD_TRACES_SAMPLE_RATE: '0.5',
        });
        expect(datadog.resolveDatadogConfig()).toMatchObject({
            enabled: true,
            site: 'datadoghq.eu',
            service: 'custom-service',
            environment: 'staging',
            version: 'v1.2.3',
            tracesSampleRate: 0.5,
        });
    });

    test('initializes the tracer with service identity when enabled', () => {
        const init = jest.fn();
        setEnv({ NODE_ENV: 'production', DATADOG_API_KEY: 'dummy-key' });

        const state = datadog.initDatadog(process.env, { tracerLoader: () => ({ init }) });
        expect(state).toEqual({ enabled: true, apiKeyConfigured: true, tracerLoaded: true });
        expect(datadog.isDatadogEnabled()).toBe(true);
        expect(init).toHaveBeenCalledTimes(1);
        expect(init.mock.calls[0][0]).toMatchObject({
            service: 'aura-marketplace-api',
            env: 'production',
        });
    });

    test('fails open when the tracer cannot be loaded', () => {
        setEnv({ NODE_ENV: 'production', DATADOG_API_KEY: 'dummy-key' });
        const state = datadog.initDatadog(process.env, {
            tracerLoader: () => {
                throw new Error('Cannot find module');
            },
        });
        expect(state.enabled).toBe(false);
        expect(state.apiKeyConfigured).toBe(true);
        expect(datadog.isDatadogEnabled()).toBe(false);
    });

    test('log forwarding is a no-op without configuration and never throws', async () => {
        setEnv({ NODE_ENV: 'production' });
        await expect(datadog.logToDatadog('error', 'boom', { route: '/x' })).resolves.toBe(false);

        setEnv({ NODE_ENV: 'test', DATADOG_API_KEY: 'dummy-key' });
        await expect(datadog.logToDatadog('error', 'boom')).resolves.toBe(false);
        await expect(datadog.logToDatadog('error')).resolves.toBe(false);
    });
});
