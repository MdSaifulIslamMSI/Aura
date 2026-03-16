jest.mock('../utils/logger', () => ({
    debug: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
}));

const mockRedisData = new Map();

const mockRedisClient = {
    setEx: jest.fn(async (key, _ttl, value) => {
        mockRedisData.set(key, value);
    }),
    get: jest.fn(async (key) => mockRedisData.get(key) || null),
    del: jest.fn(async (key) => {
        mockRedisData.delete(key);
    }),
};

jest.mock('../config/redis', () => ({
    flags: { redisPrefix: 'aura-test' },
    getRedisClient: jest.fn(() => mockRedisClient),
}));

const {
    generateCsrfToken,
    storeCsrfToken,
    verifyCsrfToken,
    csrfTokenValidator,
} = require('../middleware/csrfMiddleware');

describe('csrf middleware', () => {
    beforeEach(() => {
        mockRedisData.clear();
        mockRedisClient.setEx.mockClear();
        mockRedisClient.get.mockClear();
        mockRedisClient.del.mockClear();
    });

    test('rejects cross-user token reuse', async () => {
        const token = generateCsrfToken();
        await storeCsrfToken(token, {
            uid: 'user-a',
            strictOrigin: 'https://app.example.com',
            sessionId: 'session-a',
        });

        const valid = await verifyCsrfToken(token, {
            uid: 'user-b',
            strictOrigin: 'https://app.example.com',
            sessionId: 'session-a',
        });

        expect(valid).toBe(false);
        expect(mockRedisData.size).toBe(1);
    });

    test('rejects context mismatch on strict origin', async () => {
        const token = generateCsrfToken();
        await storeCsrfToken(token, {
            uid: 'user-a',
            strictOrigin: 'https://app.example.com',
            deviceFingerprint: 'fingerprint-a',
        });

        const valid = await verifyCsrfToken(token, {
            uid: 'user-a',
            strictOrigin: 'https://evil.example.com',
            deviceFingerprint: 'fingerprint-a',
        });

        expect(valid).toBe(false);
        expect(mockRedisData.size).toBe(1);
    });

    test('requires header-only token transport for authenticated JSON API requests', async () => {
        const req = {
            method: 'POST',
            path: '/auth/sync',
            ip: '127.0.0.1',
            authUid: 'user-1',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json',
                origin: 'https://app.example.com',
            },
            body: { csrfToken: 'body-token' },
            query: {},
        };
        const res = {};
        const next = jest.fn();

        await csrfTokenValidator(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 403,
            code: 'CSRF_TOKEN_HEADER_REQUIRED',
        }));
    });
});
