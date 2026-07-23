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
    eval: jest.fn(async (_script, { keys, arguments: args }) => {
        const [key] = keys;
        const raw = mockRedisData.get(key);
        if (!raw) return 'missing';
        let stored;
        try {
            stored = JSON.parse(raw);
        } catch {
            mockRedisData.delete(key);
            return 'invalid_record';
        }
        if (Number(stored.expiresAt || 0) <= Number(args[0])) {
            mockRedisData.delete(key);
            return 'expired';
        }
        const metadata = stored.metadata || {};
        const expectedUid = String(metadata.uid || 'anonymous');
        if (expectedUid !== args[1]) return 'principal_mismatch';
        if (metadata.strictOrigin && metadata.strictOrigin !== args[2]) return 'origin_mismatch';
        if (metadata.sessionId && metadata.sessionId !== args[3]) return 'session_mismatch';
        if (metadata.deviceFingerprint && metadata.deviceFingerprint !== args[4]) return 'device_mismatch';
        const ipMismatch = Boolean(metadata.ip && args[5] && metadata.ip !== args[5]);
        const userAgentMismatch = Boolean(metadata.userAgent && args[6] && metadata.userAgent !== args[6]);
        if (args[7] === '1' && (ipMismatch || userAgentMismatch)) return 'client_signal_mismatch';
        mockRedisData.delete(key);
        if (ipMismatch && userAgentMismatch) return 'ok:ip,user_agent';
        if (ipMismatch) return 'ok:ip';
        if (userAgentMismatch) return 'ok:user_agent';
        return 'ok';
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
    csrfTokenGenerator,
    csrfTokenValidator,
} = require('../middleware/csrfMiddleware');

describe('csrf middleware', () => {
    beforeEach(() => {
        mockRedisData.clear();
        mockRedisClient.setEx.mockClear();
        mockRedisClient.get.mockClear();
        mockRedisClient.del.mockClear();
        mockRedisClient.eval.mockClear();
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

    test('allows bearer-auth bootstrap token when session id changes', async () => {
        const token = generateCsrfToken();
        await storeCsrfToken(token, {
            uid: 'user-a',
            strictOrigin: 'https://app.example.com',
        });

        const valid = await verifyCsrfToken(token, {
            uid: 'user-a',
            strictOrigin: 'https://app.example.com',
            sessionId: 'rotated-session-b',
        });

        expect(valid).toBe(true);
        expect(mockRedisData.size).toBe(0);
    });

    test('accepts equivalent principal ids when the request uid is object-like', async () => {
        const token = generateCsrfToken();
        await storeCsrfToken(token, {
            uid: '507f1f77bcf86cd799439011',
            strictOrigin: 'https://app.example.com',
        });

        const valid = await verifyCsrfToken(token, {
            uid: {
                toString: () => '507f1f77bcf86cd799439011',
                toJSON: () => '507f1f77bcf86cd799439011',
            },
            strictOrigin: 'https://app.example.com',
        });

        expect(valid).toBe(true);
        expect(mockRedisData.size).toBe(0);
    });

    test('atomically accepts exactly one concurrent use of a one-time token', async () => {
        const token = generateCsrfToken();
        const context = {
            uid: 'user-a',
            strictOrigin: 'https://app.example.com',
            sessionId: 'session-a',
        };
        await storeCsrfToken(token, context);

        const results = await Promise.all([
            verifyCsrfToken(token, context),
            verifyCsrfToken(token, context),
        ]);

        expect(results.sort()).toEqual([false, true]);
        expect(mockRedisClient.eval).toHaveBeenCalledTimes(2);
        expect(mockRedisData.size).toBe(0);
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

    test('binds no-referrer token issuance to an allowlisted browser origin hint', async () => {
        const req = {
            method: 'GET',
            path: '/auth/session',
            protocol: 'https',
            ip: '127.0.0.1',
            user: { id: 'user-a' },
            authSession: { sessionId: 'session-a' },
            headers: {
                host: 'api.example.com',
                'x-aura-csrf-origin': 'http://localhost:5173',
            },
            get: jest.fn(() => 'test-agent'),
        };
        const res = { setHeader: jest.fn() };
        const next = jest.fn();

        await csrfTokenGenerator(req, res, next);

        const stored = JSON.parse(Array.from(mockRedisData.values())[0]);
        expect(stored.metadata).toMatchObject({
            uid: 'user-a',
            sessionId: 'session-a',
            strictOrigin: 'http://localhost:5173',
        });
        expect(res.setHeader).toHaveBeenCalledWith('X-CSRF-Token', expect.any(String));
        expect(next).toHaveBeenCalledTimes(1);
    });

    test('does not trust a disallowed browser origin hint', async () => {
        const req = {
            method: 'GET',
            path: '/auth/session',
            protocol: 'https',
            ip: '127.0.0.1',
            user: { id: 'user-a' },
            authSession: { sessionId: 'session-a' },
            headers: {
                host: 'api.example.com',
                'x-aura-csrf-origin': 'https://evil.example.com',
            },
            get: jest.fn(() => 'test-agent'),
        };

        await csrfTokenGenerator(req, { setHeader: jest.fn() }, jest.fn());

        const stored = JSON.parse(Array.from(mockRedisData.values())[0]);
        expect(stored.metadata.strictOrigin).toBe('https://api.example.com');
    });

    test('ignores body-only token transport for authenticated JSON API requests', async () => {
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
            code: 'CSRF_TOKEN_MISSING',
        }));
    });

    test('ignores body-only token transport for unauthenticated form requests', async () => {
        const req = {
            method: 'POST',
            path: '/form-submit',
            ip: '127.0.0.1',
            headers: {},
            body: { csrfToken: 'body-token' },
            query: {},
        };
        const next = jest.fn();

        await csrfTokenValidator(req, {}, next);

        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 403,
            code: 'CSRF_TOKEN_MISSING',
        }));
    });

    test('rejects array header token parameters before validation', async () => {
        const req = {
            method: 'POST',
            path: '/auth/sync',
            ip: '127.0.0.1',
            headers: { 'x-csrf-token': ['first', 'second'] },
            body: {},
            query: {},
        };
        const next = jest.fn();

        await csrfTokenValidator(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({
            statusCode: 403,
            code: 'CSRF_TOKEN_INVALID_TYPE',
        }));
    });
});
