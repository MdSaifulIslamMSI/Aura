const request = require('supertest');

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
