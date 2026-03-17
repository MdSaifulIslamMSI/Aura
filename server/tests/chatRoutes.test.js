const request = require('supertest');

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        if (req.headers.authorization === 'Bearer valid-token') {
            req.user = { _id: 'user1', isAdmin: false };
            return next();
        }
        return res.status(401).json({ message: 'Not authorized' });
    },
    protectOptional: (req, res, next) => next(),
    admin: (req, res, next) => next(),
    seller: (req, res, next) => next(),
    requireOtpAssurance: (req, res, next) => next(),
    requireActiveAccount: (req, res, next) => next(),
    invalidateUserCache: jest.fn(),
    invalidateUserCacheByEmail: jest.fn(),
}));

jest.mock('../services/assistantCommerceService', () => ({
    buildGroundedCatalogContext: jest.fn().mockResolvedValue({
        commerceIntent: false,
        actionType: 'assistant',
        products: [],
        groundingPrompt: '',
    }),
    buildCommerceFallbackResponse: jest.fn().mockResolvedValue(null),
    executeCatalogActions: jest.fn().mockResolvedValue({
        products: [],
        actionType: 'assistant',
    }),
}));

jest.mock('../services/ai/assistantOrchestratorService', () => ({
    processAssistantTurn: jest.fn().mockResolvedValue({
        answer: 'Legacy-compatible answer',
        products: [],
        actions: [],
        followUps: ['Best deals today'],
        grounding: {
            mode: 'chat',
            actionType: 'assistant',
        },
        provider: 'local',
        latencyMs: 8,
        legacy: {
            text: 'Legacy-compatible answer',
            products: [],
            suggestions: ['Best deals today'],
            actionType: 'assistant',
            isAI: false,
        },
    }),
}));

const app = require('../index');

describe('Chat Routes Security', () => {
    test('POST /api/chat/public works without auth', async () => {
        const res = await request(app)
            .post('/api/chat/public')
            .send({ message: 'show deals' });

        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('text');
        expect(res.body.mode).toBe('public');
    });

    test('POST /api/chat requires auth', async () => {
        const res = await request(app)
            .post('/api/chat')
            .send({ message: 'hello' });

        expect(res.statusCode).toBe(401);
    });
});
