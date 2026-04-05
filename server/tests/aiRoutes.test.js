const request = require('supertest');

jest.mock('../services/ai/assistantOrchestratorService', () => ({
    processAssistantTurn: jest.fn().mockResolvedValue({
        answer: 'Top grounded answer',
        products: [],
        actions: [],
        followUps: ['Compare products'],
        assistantTurn: {
            intent: 'general_knowledge',
            entities: {
                query: '',
                productId: '',
                productIds: [],
                quantity: 0,
                priceMin: 0,
                priceMax: 0,
                category: '',
                page: '',
                orderId: '',
                supportCategory: '',
                operation: '',
                compareTerms: [],
            },
            confidence: 0.88,
            decision: 'respond',
            response: 'Top grounded answer',
            actions: [],
            ui: { surface: 'plain_answer' },
            contextPatch: {},
            followUps: ['Compare products'],
            safetyFlags: [],
        },
        grounding: {
            mode: 'chat',
            actionType: 'assistant',
        },
        provider: 'local',
        latencyMs: 12,
    }),
}));

const app = require('../index');
const { processAssistantTurn } = require('../services/ai/assistantOrchestratorService');

describe('AI Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('POST /api/ai/chat works without auth', async () => {
        const res = await request(app)
            .post('/api/ai/chat')
            .send({
                message: 'compare phones under 50000',
                assistantMode: 'chat',
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.answer).toBe('Top grounded answer');
        expect(res.body.provider).toBe('local');
        expect(res.body.assistantTurn).toMatchObject({
            intent: 'general_knowledge',
            decision: 'respond',
            response: 'Top grounded answer',
        });
        expect(res.body.grounding).toMatchObject({
            mode: 'chat',
            actionType: 'assistant',
        });
    });

    test('POST /api/ai/chat accepts backend-owned action requests without a message', async () => {
        const res = await request(app)
            .post('/api/ai/chat')
            .send({
                actionRequest: {
                    type: 'checkout',
                },
                assistantMode: 'chat',
            });

        expect(res.statusCode).toBe(200);
        expect(processAssistantTurn).toHaveBeenCalledWith(expect.objectContaining({
            message: '',
            actionRequest: {
                type: 'checkout',
            },
        }));
    });

});
