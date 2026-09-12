// Integration: a 5xx through errorMiddleware forwards to the Datadog log
// intake (mocked fetch); 4xx never forwards. Datadog is enabled here via an
// explicit test env — production stays untouched.
jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const AppError = require('../utils/AppError');
const datadog = require('../utils/datadog');
const { errorHandler } = require('../middleware/errorMiddleware');

const waitFor = async (predicate, timeoutMs = 2000) => {
    const startedAt = Date.now();
    for (;;) {
        if (predicate()) return true;
        if (Date.now() - startedAt > timeoutMs) return false;
        await new Promise((resolve) => { setTimeout(resolve, 25); });
    }
};

describe('errorMiddleware datadog forwarding', () => {
    const savedEnv = { ...process.env };
    const realFetch = global.fetch;

    const setEnv = (overrides) => {
        delete process.env.DATADOG_API_KEY;
        delete process.env.DD_API_KEY;
        delete process.env.DD_ENABLED;
        delete process.env.DATADOG_ENABLED;
        delete process.env.DD_SITE;
        delete process.env.DATADOG_SITE;
        delete process.env.DD_ENV;
        delete process.env.DD_VERSION;
        delete process.env.RELEASE_ID;
        delete process.env.GITHUB_SHA;
        Object.assign(process.env, overrides);
    };

    const buildApp = () => {
        const app = express();
        app.get('/boom', (req, res, next) => {
            req.requestId = 'datadog-probe-req';
            next(new Error('kaboom'));
        });
        app.get('/missing-thing', (req, res, next) => {
            next(new AppError('No such thing', 404));
        });
        app.use(errorHandler);
        return app;
    };

    beforeEach(() => {
        datadog.resetDatadogForTests();
        setEnv({ NODE_ENV: 'production', DATADOG_API_KEY: 'dummy-key', DD_SITE: 'us5.datadoghq.com' });
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 202 });
    });

    afterEach(() => {
        datadog.resetDatadogForTests();
        process.env = { ...savedEnv };
        global.fetch = realFetch;
    });

    test('a 5xx response forwards a redacted payload to the intake', async () => {
        const response = await request(buildApp()).get('/boom');
        expect(response.status).toBe(500);
        expect(await waitFor(() => global.fetch.mock.calls.length > 0)).toBe(true);

        const [url, options] = global.fetch.mock.calls[0];
        expect(url).toBe('https://http-intake.logs.us5.datadoghq.com/api/v2/logs');
        expect(options.method).toBe('POST');
        expect(options.headers['DD-API-KEY']).toBe('dummy-key');
        const payload = JSON.parse(options.body);
        expect(payload).toMatchObject({
            status: 'error',
            service: 'aura-marketplace-api',
            route: '/boom',
            request_id: 'datadog-probe-req',
            http_status_code: 500,
        });
        expect(JSON.stringify(payload)).not.toContain('dummy-key');
    });

    test('a 4xx response never touches the intake', async () => {
        const response = await request(buildApp()).get('/missing-thing');
        expect(response.status).toBe(404);
        await new Promise((resolve) => { setTimeout(resolve, 250); });
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('a disabled Datadog never touches the intake even on 5xx', async () => {
        setEnv({ NODE_ENV: 'production' });
        const response = await request(buildApp()).get('/boom');
        expect(response.status).toBe(500);
        await new Promise((resolve) => { setTimeout(resolve, 250); });
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
