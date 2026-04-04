const express = require('express');
const request = require('supertest');

jest.mock('../middleware/authMiddleware', () => ({
    protectOptional: (req, res, next) => {
        if (req.headers.authorization) {
            req.user = { _id: 'user-1' };
        }
        next();
    },
}));

jest.mock('../services/catalogService', () => ({
    getProductByIdentifier: jest.fn(),
}));

jest.mock('../services/ai/assistantOrchestratorService', () => ({
    processAssistantTurn: jest.fn(),
}));

const { flags: assistantFlags } = require('../config/assistantFlags');
const { getProductByIdentifier } = require('../services/catalogService');
const { processAssistantTurn } = require('../services/ai/assistantOrchestratorService');
const assistantRoutes = require('../routes/assistantRoutes');

describe('assistantRoutes v2', () => {
    const app = express();
    app.use(express.json());
    app.use('/api/assistant', assistantRoutes);
    app.use((err, req, res, next) => {
        res.status(err.statusCode || err.status || 500).json({
            message: err.message,
        });
    });

    beforeEach(() => {
        assistantFlags.assistantV2Enabled = true;
        jest.clearAllMocks();
        getProductByIdentifier.mockImplementation(async (productId) => ({
            id: productId,
            title: productId === 'phone-pro' ? 'Phone Pro' : 'Phone Lite',
            brand: 'Aura',
            category: 'Mobiles',
            price: productId === 'phone-pro' ? 49999 : 31999,
            originalPrice: productId === 'phone-pro' ? 54999 : 35999,
            image: `https://example.com/${productId}.png`,
            rating: 4.5,
            ratingCount: 1200,
            stock: 7,
        }));
    });

    test('returns orchestrator-grounded product results for guests', async () => {
        processAssistantTurn.mockResolvedValue({
            answer: 'I found 2 grounded product options for that brief.',
            provider: 'groq',
            latencyMs: 42,
            products: [
                {
                    id: 'phone-pro',
                    title: 'Phone Pro',
                    brand: 'Aura',
                    category: 'Mobiles',
                    price: 49999,
                    originalPrice: 54999,
                    image: 'https://example.com/phone-pro.png',
                    rating: 4.6,
                    ratingCount: 1800,
                    stock: 9,
                },
                {
                    id: 'phone-lite',
                    title: 'Phone Lite',
                    brand: 'Aura',
                    category: 'Mobiles',
                    price: 31999,
                    originalPrice: 35999,
                    image: 'https://example.com/phone-lite.png',
                    rating: 4.3,
                    ratingCount: 900,
                    stock: 12,
                },
            ],
            actions: [
                {
                    type: 'navigate_to',
                    page: 'product',
                    params: {
                        productId: 'phone-pro',
                    },
                },
                {
                    type: 'add_to_cart',
                    productId: 'phone-pro',
                    quantity: 1,
                },
            ],
            assistantSession: {
                sessionId: 'session-1',
            },
            assistantTurn: {
                intent: 'product_search',
                confidence: 0.93,
                response: 'I found 2 grounded product options for that brief.',
                answerMode: 'runtime_grounded',
                ui: {
                    surface: 'product_results',
                    products: [
                        {
                            id: 'phone-pro',
                            title: 'Phone Pro',
                            brand: 'Aura',
                            category: 'Mobiles',
                            price: 49999,
                            originalPrice: 54999,
                            image: 'https://example.com/phone-pro.png',
                            rating: 4.6,
                            ratingCount: 1800,
                            stock: 9,
                        },
                        {
                            id: 'phone-lite',
                            title: 'Phone Lite',
                            brand: 'Aura',
                            category: 'Mobiles',
                            price: 31999,
                            originalPrice: 35999,
                            image: 'https://example.com/phone-lite.png',
                            rating: 4.3,
                            ratingCount: 900,
                            stock: 12,
                        },
                    ],
                },
            },
        });

        const res = await request(app)
            .post('/api/assistant/turns')
            .send({
                message: 'best phones under 50000',
                routeContext: {
                    path: '/',
                },
                commerceContext: {
                    candidateProductIds: ['phone-pro', 'phone-lite'],
                    cartSummary: {
                        totalItems: 0,
                        itemCount: 0,
                        totalPrice: 0,
                        currency: 'INR',
                    },
                },
                userContext: {
                    authenticated: false,
                },
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.reply).toMatchObject({
            intent: 'product_search',
            text: 'I found 2 grounded product options for that brief.',
        });
        expect(res.body.cards[0]).toMatchObject({
            type: 'product',
            product: {
                id: 'phone-pro',
            },
        });
        expect(res.body.actions).toEqual(expect.arrayContaining([
            expect.objectContaining({
                type: 'navigate_to',
                page: 'product',
                params: {
                    productId: 'phone-pro',
                },
            }),
            expect.objectContaining({
                type: 'add_to_cart',
                productId: 'phone-pro',
            }),
        ]));
        expect(res.body.telemetry.source).toBe('planner:groq');
    });

    test('surfaces checkout confirmation instead of bypassing the backend policy', async () => {
        processAssistantTurn.mockResolvedValue({
            answer: 'Checkout affects payment and order placement. Should I open checkout?',
            provider: 'local',
            latencyMs: 18,
            products: [],
            actions: [],
            assistantSession: {
                sessionId: 'session-2',
            },
            assistantTurn: {
                intent: 'navigation',
                confidence: 0.88,
                response: 'Checkout affects payment and order placement. Should I open checkout?',
                answerMode: 'commerce',
                ui: {
                    surface: 'confirmation_card',
                    confirmation: {
                        message: 'Checkout affects payment and order placement. Confirm before continuing.',
                        action: {
                            type: 'navigate_to',
                            page: 'checkout',
                            params: {},
                            requiresConfirmation: true,
                        },
                    },
                },
            },
        });

        const res = await request(app)
            .post('/api/assistant/turns')
            .set('Authorization', 'Bearer fake')
            .send({
                message: 'checkout',
                routeContext: {
                    path: '/cart',
                },
                commerceContext: {
                    cartSummary: {
                        totalItems: 2,
                        itemCount: 1,
                        totalPrice: 1999,
                        totalOriginalPrice: 2399,
                        totalDiscount: 400,
                        currency: 'INR',
                    },
                },
                userContext: {
                    authenticated: true,
                },
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.reply.intent).toBe('navigation');
        expect(res.body.cards[0]).toMatchObject({
            type: 'empty_state',
            title: 'Confirmation needed',
        });
        expect(res.body.actions).toEqual([]);
        expect(res.body.reply.text).toContain('Should I open checkout');
    });

    test('maps support handoff into the workspace response contract', async () => {
        processAssistantTurn.mockResolvedValue({
            answer: 'I prepared a support handoff for this order issue.',
            provider: 'local',
            latencyMs: 21,
            products: [],
            actions: [
                {
                    type: 'open_support',
                    orderId: 'ORD-123',
                    prefill: {
                        category: 'returns',
                        subject: 'Refund request',
                        body: 'Customer needs help with a refund.',
                    },
                },
            ],
            assistantSession: {
                sessionId: 'session-3',
            },
            assistantTurn: {
                intent: 'support',
                confidence: 0.94,
                response: 'I prepared a support handoff for this order issue.',
                answerMode: 'commerce',
                ui: {
                    surface: 'support_handoff',
                    support: {
                        orderId: 'ORD-123',
                        prefill: {
                            category: 'returns',
                            subject: 'Refund request',
                            body: 'Customer needs help with a refund.',
                        },
                    },
                },
            },
        });

        const res = await request(app)
            .post('/api/assistant/turns')
            .send({
                message: 'i need refund help',
                routeContext: {
                    path: '/orders',
                },
                commerceContext: {
                    cartSummary: {
                        totalItems: 0,
                        itemCount: 0,
                        totalPrice: 0,
                        currency: 'INR',
                    },
                },
                userContext: {
                    authenticated: true,
                },
            });

        expect(res.statusCode).toBe(200);
        expect(res.body.reply.intent).toBe('support');
        expect(res.body.supportDraft).toMatchObject({
            category: 'returns',
            subject: 'Refund request',
            body: 'Customer needs help with a refund.',
            relatedOrderId: 'ORD-123',
        });
        expect(res.body.actions[0]).toMatchObject({
            type: 'open_support',
            orderId: 'ORD-123',
        });
    });

    test('respects the feature flag when disabled', async () => {
        assistantFlags.assistantV2Enabled = false;

        const res = await request(app)
            .post('/api/assistant/turns')
            .send({
                message: 'best phones',
                routeContext: {
                    path: '/',
                },
                commerceContext: {},
                userContext: {},
            });

        expect(res.statusCode).toBe(404);
        expect(res.body.message).toMatch(/disabled/i);
    });
});
