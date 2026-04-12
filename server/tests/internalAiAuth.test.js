describe('internal AI auth middleware', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
        jest.resetModules();
        jest.clearAllMocks();
    });

    test('allows requests with a valid signed internal AI service token', () => {
        process.env.AI_INTERNAL_AUTH_ACTIVE_KID = 'ai-2026-04';
        process.env.AI_INTERNAL_AUTH_SECRET = 'internal-ai-secret-current-0123456789abcdefghijklmnopqrstuvwxyz';
        process.env.AI_INTERNAL_AUTH_ISSUER = 'aura-internal-ai';
        process.env.AI_INTERNAL_AUTH_AUDIENCE = 'aura-api';
        process.env.AI_INTERNAL_AUTH_ALLOW_LEGACY_SECRET = 'false';

        const {
            issueInternalAiServiceToken,
        } = require('../services/internalAiTokenService');
        const { requireInternalAiAuth } = require('../middleware/internalAiAuth');

        const { token } = issueInternalAiServiceToken({
            subject: 'assistant-worker',
            audience: 'aura-api',
        });

        const req = {
            headers: {
                authorization: `Bearer ${token}`,
                'user-agent': 'assistant-worker/1.0',
                'x-intelligence-service': 'assistant-worker',
            },
            originalUrl: '/api/internal/ai/assistant-turn',
            requestId: 'req_signed_1',
        };
        const next = jest.fn();

        requireInternalAiAuth(req, {}, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.internalAi).toMatchObject({
            authMode: 'signed_token',
            source: 'assistant-worker',
            issuer: 'aura-internal-ai',
            audience: 'aura-api',
            keyVersion: 'ai-2026-04',
            tokenVersion: 'v1',
            scope: 'internal:ai',
        });
    });

    test('rejects signed tokens with the wrong audience', () => {
        process.env.AI_INTERNAL_AUTH_ACTIVE_KID = 'ai-2026-04';
        process.env.AI_INTERNAL_AUTH_SECRET = 'internal-ai-secret-current-0123456789abcdefghijklmnopqrstuvwxyz';
        process.env.AI_INTERNAL_AUTH_ISSUER = 'aura-internal-ai';
        process.env.AI_INTERNAL_AUTH_AUDIENCE = 'aura-api';
        process.env.AI_INTERNAL_AUTH_ALLOW_LEGACY_SECRET = 'false';

        const {
            issueInternalAiServiceToken,
        } = require('../services/internalAiTokenService');
        const { requireInternalAiAuth } = require('../middleware/internalAiAuth');

        const { token } = issueInternalAiServiceToken({
            subject: 'assistant-worker',
            audience: 'wrong-audience',
        });

        const req = {
            headers: {
                authorization: `Bearer ${token}`,
                'user-agent': 'assistant-worker/1.0',
            },
            originalUrl: '/api/internal/ai/assistant-turn',
            requestId: 'req_signed_2',
        };
        const next = jest.fn();

        requireInternalAiAuth(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        const error = next.mock.calls[0][0];
        expect(error).toBeTruthy();
        expect(error.statusCode).toBe(401);
    });

    test('allows legacy bearer secret only when migration fallback is enabled', () => {
        process.env.AI_INTERNAL_TOOL_SECRET = 'legacy-internal-ai-secret';
        process.env.AI_INTERNAL_AUTH_ALLOW_LEGACY_SECRET = 'true';
        delete process.env.AI_INTERNAL_AUTH_SECRET;

        const { requireInternalAiAuth } = require('../middleware/internalAiAuth');

        const req = {
            headers: {
                authorization: 'Bearer legacy-internal-ai-secret',
                'x-intelligence-service': 'legacy-worker',
                'user-agent': 'legacy-worker/1.0',
            },
            originalUrl: '/api/internal/ai/assistant-turn',
            requestId: 'req_legacy_1',
        };
        const next = jest.fn();

        requireInternalAiAuth(req, {}, next);

        expect(next).toHaveBeenCalledWith();
        expect(req.internalAi).toMatchObject({
            authMode: 'legacy_secret',
            source: 'legacy-worker',
            tokenVersion: 'legacy',
        });
    });

    test('rejects legacy bearer secret after signed-token mode disables fallback', () => {
        process.env.AI_INTERNAL_AUTH_ACTIVE_KID = 'ai-2026-04';
        process.env.AI_INTERNAL_AUTH_SECRET = 'internal-ai-secret-current-0123456789abcdefghijklmnopqrstuvwxyz';
        process.env.AI_INTERNAL_AUTH_ISSUER = 'aura-internal-ai';
        process.env.AI_INTERNAL_AUTH_AUDIENCE = 'aura-api';
        process.env.AI_INTERNAL_AUTH_ALLOW_LEGACY_SECRET = 'false';
        process.env.AI_INTERNAL_TOOL_SECRET = 'legacy-internal-ai-secret';

        const { requireInternalAiAuth } = require('../middleware/internalAiAuth');

        const req = {
            headers: {
                authorization: 'Bearer legacy-internal-ai-secret',
                'x-intelligence-service': 'legacy-worker',
                'user-agent': 'legacy-worker/1.0',
            },
            originalUrl: '/api/internal/ai/assistant-turn',
            requestId: 'req_legacy_2',
        };
        const next = jest.fn();

        requireInternalAiAuth(req, {}, next);

        expect(next).toHaveBeenCalledTimes(1);
        const error = next.mock.calls[0][0];
        expect(error).toBeTruthy();
        expect(error.statusCode).toBe(401);
    });
});
