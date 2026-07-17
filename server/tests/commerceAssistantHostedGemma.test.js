const createLeanQuery = (result) => ({
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
});

jest.mock('../models/Order', () => ({
    find: jest.fn(() => createLeanQuery([])),
    findOne: jest.fn(() => createLeanQuery(null)),
}));

jest.mock('../models/Product', () => ({
    find: jest.fn(() => createLeanQuery([])),
    findOne: jest.fn(() => createLeanQuery(null)),
}));

jest.mock('../services/ai/assistantContract', () => ({
    buildAssistantTurn: jest.fn((payload = {}) => ({
        actions: [],
        followUps: [],
        ui: { surface: 'plain_answer' },
        ...payload,
    })),
    buildConfirmationToken: jest.fn(() => 'confirmation-token'),
    safeString: jest.fn((value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim()),
}));

jest.mock('../services/ai/assistantToolRegistry', () => ({
    ASSISTANT_NAVIGATION_PATHS: {
        price_alerts: '/price-alerts',
    },
    validateAssistantAction: jest.fn(() => ({ ok: true, definition: { mutation: false } })),
}));

jest.mock('../services/ai/assistantObservabilityService', () => ({
    recordFallbackMetric: jest.fn(),
    recordLatencyMetric: jest.fn(),
    recordRetrievalMetric: jest.fn(),
    recordRouteDecisionMetric: jest.fn(),
    recordToolValidationMetric: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
}));

jest.mock('../services/productImageResolver', () => ({
    canonicalizeProductImageUrl: jest.fn((value) => value || ''),
}));

jest.mock('../services/ai/assistantThreadPersistenceService', () => ({
    archiveAssistantThread: jest.fn(),
    listAssistantThreads: jest.fn(),
    loadAssistantThread: jest.fn().mockResolvedValue(null),
    persistAssistantExchange: jest.fn().mockResolvedValue(null),
    resetAssistantThread: jest.fn(),
    upsertAssistantThread: jest.fn(),
}));

jest.mock('../services/ai/modelGatewayService', () => ({
    checkModelGatewayHealth: jest.fn(),
    generateStructuredJson: jest.fn(),
    getModelGatewayHealth: jest.fn(),
}));

jest.mock('../services/ai/localProductVectorIndexService', () => ({
    getLocalVectorIndexHealth: jest.fn().mockResolvedValue({ healthy: true, provider: 'local_vector' }),
    searchProductVectorIndex: jest.fn().mockResolvedValue({
        results: [],
        retrievalHitCount: 0,
        provider: 'local_vector',
        fallbackUsed: false,
        fallbackReason: 'none',
    }),
}));

jest.setTimeout(15000);

describe('commerceAssistantService hosted Gemma enforcement', () => {
    const product = {
        id: 400047506,
        title: 'Dell Inspiron 14',
        displayTitle: 'Dell Inspiron 14',
        brand: 'Dell',
        category: 'Laptops',
        price: 49999,
        originalPrice: 57999,
        discountPercentage: 14,
        image: 'https://cdn.example.com/dell-inspiron-14.png',
        images: ['https://cdn.example.com/dell-inspiron-14.png'],
        stock: 5,
        rating: 4.4,
        ratingCount: 127,
        deliveryTime: 'Usually dispatches in 2 days',
        warranty: '1 year manufacturer warranty',
        description: 'A portable laptop for work and study.',
        highlights: ['16GB RAM', '512GB SSD'],
        specifications: [
            { key: 'RAM', value: '16GB' },
            { key: 'Battery', value: 'Up to 10 hours' },
        ],
    };

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA = 'true';
    });

    afterEach(() => {
        delete process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA;
        delete process.env.ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED;
        delete process.env.ASSISTANT_COMMERCE_MEDIA_REASONING_ENABLED;
    });

    test('answers greetings locally without waiting on model gateway health or generation', async () => {
        const modelGateway = require('../services/ai/modelGatewayService');
        modelGateway.getModelGatewayHealth.mockReturnValue({
            provider: 'disabled',
            activeProvider: 'disabled',
            healthy: false,
            capabilities: {
                chat: 'disabled',
            },
        });

        const { processAssistantTurn } = require('../services/ai/commerceAssistantService');
        const result = await processAssistantTurn({
            message: 'hello',
        });

        expect(result.route).toBe('GENERAL');
        expect(result.provider).toBe('rule');
        expect(result.answer).toContain('I can help you find products');
        expect(result.grounding.validator).toMatchObject({
            ok: true,
            reason: 'small_talk_rule',
        });
        expect(modelGateway.checkModelGatewayHealth).not.toHaveBeenCalled();
        expect(modelGateway.generateStructuredJson).not.toHaveBeenCalled();
    });

    test('still reads catalog data when hosted Gemma is down', async () => {
        const modelGateway = require('../services/ai/modelGatewayService');
        const vectorIndex = require('../services/ai/localProductVectorIndexService');
        modelGateway.checkModelGatewayHealth.mockResolvedValue({
            provider: 'gemini',
            activeProvider: 'gemini',
            healthy: false,
            apiConfigured: true,
            chatModel: 'models/gemma-4-31b-it',
            resolvedChatModel: 'models/gemma-4-31b-it',
            error: 'upstream_down',
            capabilities: {
                textInput: true,
                imageInput: true,
                audioInput: false,
            },
        });
        modelGateway.getModelGatewayHealth.mockReturnValue({
            provider: 'gemini',
            activeProvider: 'gemini',
            healthy: false,
            apiConfigured: true,
            chatModel: 'models/gemma-4-31b-it',
            resolvedChatModel: 'models/gemma-4-31b-it',
        });
        vectorIndex.searchProductVectorIndex.mockResolvedValue({
            results: [{ product, score: 0.97 }],
            retrievalHitCount: 1,
            provider: 'local_vector',
            fallbackUsed: false,
            fallbackReason: 'none',
        });

        const { processAssistantTurn } = require('../services/ai/commerceAssistantService');
        const result = await processAssistantTurn({
            message: 'show me a dell laptop under 50000',
        });

        expect(result.route).toBe('ECOMMERCE_SEARCH');
        expect(result.provider).toBe('gemini');
        expect(result.answer).toContain('Hosted Gemma commerce reasoning is temporarily unavailable');
        expect(result.grounding.validator).toMatchObject({
            ok: false,
            reason: 'hosted_gemma_gateway_unavailable',
            requiredProvider: 'gemini',
        });
        expect(result.answer).toContain('**Grounded picks**');
        expect(result.products).toEqual([
            expect.objectContaining({
                id: 400047506,
                title: 'Dell Inspiron 14',
                assistantReason: expect.stringContaining('in stock'),
                deliveryTime: 'Usually dispatches in 2 days',
                warranty: '1 year manufacturer warranty',
            }),
        ]);
        expect(vectorIndex.searchProductVectorIndex).toHaveBeenCalled();
    });

    test('refuses to downgrade to a weaker summary when hosted Gemma generation fails after retrieval', async () => {
        const modelGateway = require('../services/ai/modelGatewayService');
        const vectorIndex = require('../services/ai/localProductVectorIndexService');

        modelGateway.checkModelGatewayHealth.mockResolvedValue({
            provider: 'gemini',
            activeProvider: 'gemini',
            healthy: true,
            apiConfigured: true,
            chatModel: 'models/gemma-4-31b-it',
            resolvedChatModel: 'models/gemma-4-31b-it',
            capabilities: {
                textInput: true,
                imageInput: true,
                audioInput: false,
            },
        });
        modelGateway.getModelGatewayHealth.mockReturnValue({
            provider: 'gemini',
            activeProvider: 'gemini',
            healthy: true,
            apiConfigured: true,
            chatModel: 'models/gemma-4-31b-it',
            resolvedChatModel: 'models/gemma-4-31b-it',
        });
        modelGateway.generateStructuredJson.mockRejectedValue(new Error('gemini_timeout'));
        vectorIndex.searchProductVectorIndex.mockResolvedValue({
            results: [{ product, score: 0.97 }],
            retrievalHitCount: 1,
            provider: 'local_vector',
            fallbackUsed: false,
            fallbackReason: 'none',
        });

        const { processAssistantTurn } = require('../services/ai/commerceAssistantService');
        const result = await processAssistantTurn({
            message: 'show me a dell laptop under 50000',
        });

        expect(result.route).toBe('ECOMMERCE_SEARCH');
        expect(result.provider).toBe('gemini');
        expect(result.answer).toContain('without downgrading to a weaker shopping answer');
        expect(result.products).toEqual([
            expect.objectContaining({
                id: 400047506,
                title: 'Dell Inspiron 14',
            }),
        ]);
        expect(result.grounding.validator).toMatchObject({
            ok: false,
            reason: 'gemini_timeout',
            requiredProvider: 'gemini',
            retrievalProvider: 'local_vector',
        });
    });

    test('reuses session results for comparison follow-ups instead of re-searching', async () => {
        const modelGateway = require('../services/ai/modelGatewayService');
        const vectorIndex = require('../services/ai/localProductVectorIndexService');

        modelGateway.checkModelGatewayHealth.mockResolvedValue({
            provider: 'gemini',
            activeProvider: 'gemini',
            healthy: true,
            apiConfigured: true,
            chatModel: 'models/gemma-4-31b-it',
            resolvedChatModel: 'models/gemma-4-31b-it',
            capabilities: {
                textInput: true,
                imageInput: true,
                audioInput: false,
            },
        });
        modelGateway.getModelGatewayHealth.mockReturnValue({
            provider: 'gemini',
            activeProvider: 'gemini',
            healthy: true,
            apiConfigured: true,
            chatModel: 'models/gemma-4-31b-it',
            resolvedChatModel: 'models/gemma-4-31b-it',
        });
        modelGateway.generateStructuredJson.mockResolvedValue({
            data: {
                answer: 'Vivo V9 has the best rating among these options.',
                productIds: ['400047506'],
                focusProductId: '400047506',
                followUps: ['Compare battery life'],
            },
            provider: 'gemini',
            providerModel: 'models/gemma-4-31b-it',
        });

        const { processAssistantTurn } = require('../services/ai/commerceAssistantService');
        const result = await processAssistantTurn({
            message: 'which one has the best rating and why',
            context: {
                assistantSession: {
                    lastIntent: 'product_search',
                    lastEntities: { query: 'top rated phones under 15000' },
                    lastResults: [product],
                },
            },
            conversationHistory: [
                { role: 'user', content: 'show me top rated in stock phone under 15000' },
                { role: 'assistant', content: 'Here are your validated options.' },
            ],
        });

        expect(vectorIndex.searchProductVectorIndex).not.toHaveBeenCalled();
        expect(result.route).toBe('ECOMMERCE_SEARCH');
        expect(result.provider).toBe('gemini');
        expect(result.products).toEqual([
            expect.objectContaining({
                id: 400047506,
                title: 'Dell Inspiron 14',
            }),
        ]);
        expect(result.grounding.validator).toMatchObject({
            ok: true,
            reason: 'model_json_valid',
            retrievalQuery: {
                ok: true,
                reason: 'session_result_context',
            },
            retrievalProvider: 'assistant_session',
        });
    });

    test('answers policy questions from local knowledge when no catalog product matches', async () => {
        process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA = 'false';
        const modelGateway = require('../services/ai/modelGatewayService');
        const vectorIndex = require('../services/ai/localProductVectorIndexService');

        modelGateway.checkModelGatewayHealth.mockResolvedValue({
            provider: 'ollama',
            activeProvider: 'ollama',
            healthy: false,
            apiConfigured: false,
            chatModel: 'llama3.2:3b',
            resolvedChatModel: '',
            capabilities: {
                textInput: true,
                imageInput: false,
                audioInput: false,
            },
        });
        modelGateway.getModelGatewayHealth.mockReturnValue({
            provider: 'ollama',
            activeProvider: 'ollama',
            healthy: false,
            apiConfigured: false,
            chatModel: 'llama3.2:3b',
        });
        vectorIndex.searchProductVectorIndex.mockResolvedValue({
            results: [],
            retrievalHitCount: 0,
            provider: 'local_vector',
            fallbackUsed: false,
            fallbackReason: 'none',
        });

        const { processAssistantTurn } = require('../services/ai/commerceAssistantService');
        const result = await processAssistantTurn({
            message: 'what is the return and refund policy',
        });

        expect(result.route).toBe('ECOMMERCE_SEARCH');
        expect(result.provider).toBe('local_knowledge');
        expect(result.answer).toContain('Return and refund policy');
        expect(result.assistantTurn.citations).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'policy:return-refund',
                type: 'policy',
            }),
        ]));
        expect(result.grounding.validator).toMatchObject({
            ok: true,
            reason: 'knowledge_first_grounding',
            knowledgeHitCount: expect.any(Number),
        });
    });

    test('answers budget and specification search from canonical catalog facts with the model disabled', async () => {
        process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA = 'false';
        process.env.ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED = 'false';
        const modelGateway = require('../services/ai/modelGatewayService');
        const vectorIndex = require('../services/ai/localProductVectorIndexService');
        modelGateway.getModelGatewayHealth.mockReturnValue({
            provider: 'disabled',
            activeProvider: 'disabled',
            healthy: false,
            capabilities: { chat: 'disabled' },
        });
        vectorIndex.searchProductVectorIndex.mockResolvedValue({
            results: [{ product, score: 0.97 }],
            retrievalHitCount: 1,
            provider: 'local_vector',
            fallbackUsed: false,
            fallbackReason: 'none',
        });

        const { processAssistantTurn } = require('../services/ai/commerceAssistantService');
        const result = await processAssistantTurn({
            message: 'show 16GB RAM laptops under ₹60k',
        });

        expect(result.provider).toBe('rule');
        expect(result.answer).toContain('Dell Inspiron 14');
        expect(result.answer).toContain('Rs 49,999');
        expect(result.answer).toContain('5 in stock');
        expect(vectorIndex.searchProductVectorIndex).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({
                filters: expect.objectContaining({
                    category: 'Laptops',
                    maxPrice: 60000,
                    requiredTerms: expect.arrayContaining(['16 gb', 'ram']),
                }),
            }),
        );
        expect(modelGateway.checkModelGatewayHealth).not.toHaveBeenCalled();
        expect(modelGateway.generateStructuredJson).not.toHaveBeenCalled();
    });

    test('answers a contextual product-detail question from the product database without a model', async () => {
        process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA = 'false';
        const modelGateway = require('../services/ai/modelGatewayService');
        const Product = require('../models/Product');
        modelGateway.getModelGatewayHealth.mockReturnValue({
            provider: 'disabled',
            activeProvider: 'disabled',
            healthy: false,
            capabilities: { chat: 'disabled' },
        });
        Product.findOne.mockReturnValue(createLeanQuery(product));

        const { processAssistantTurn } = require('../services/ai/commerceAssistantService');
        const result = await processAssistantTurn({
            message: 'what are the battery specs?',
            context: { currentProductId: String(product.id) },
        });

        expect(result.route).toBe('ACTION');
        expect(result.answer).toContain('Battery: Up to 10 hours');
        expect(result.answer).toContain('Rating: 4.4/5');
        expect(result.products).toEqual([expect.objectContaining({ id: product.id })]);
        expect(modelGateway.generateStructuredJson).not.toHaveBeenCalled();
    });

    test('calculates a useful cart subtotal from current app context without inventing checkout totals', async () => {
        process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA = 'false';
        const modelGateway = require('../services/ai/modelGatewayService');
        modelGateway.getModelGatewayHealth.mockReturnValue({
            provider: 'disabled', activeProvider: 'disabled', healthy: false, capabilities: { chat: 'disabled' },
        });

        const { processAssistantTurn } = require('../services/ai/commerceAssistantService');
        const result = await processAssistantTurn({
            message: 'what is my cart subtotal?',
            context: {
                cartItems: [
                    { id: 101, title: 'Phone Case', price: 499, quantity: 2 },
                    { id: 202, title: 'USB Cable', price: 299, quantity: 1 },
                ],
            },
        });

        expect(result.route).toBe('ACTION');
        expect(result.answer).toContain('Item subtotal: Rs 1,297');
        expect(result.answer).toContain('Checkout will verify shipping, taxes, coupons, stock, and the final payable total');
        expect(result.grounding.validator).toMatchObject({ ok: true, reason: 'cart_context_summary' });
    });

    test('caps add quantity by canonical stock and removes only an identified cart item', async () => {
        process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA = 'false';
        const modelGateway = require('../services/ai/modelGatewayService');
        const Product = require('../models/Product');
        const vectorIndex = require('../services/ai/localProductVectorIndexService');
        modelGateway.getModelGatewayHealth.mockReturnValue({
            provider: 'disabled', activeProvider: 'disabled', healthy: false, capabilities: { chat: 'disabled' },
        });
        Product.findOne.mockReturnValue(createLeanQuery(product));
        const { processAssistantTurn } = require('../services/ai/commerceAssistantService');

        const add = await processAssistantTurn({
            actionRequest: { type: 'add_to_cart', productId: String(product.id), quantity: 99 },
        });
        const remove = await processAssistantTurn({
            message: 'remove the second item',
            context: {
                cartItems: [
                    { id: 101, title: 'Phone Case', price: 499 },
                    { id: 202, title: 'USB Cable', price: 299 },
                ],
            },
        });

        expect(add.assistantTurn.ui.confirmation.action).toMatchObject({
            type: 'add_to_cart',
            productId: String(product.id),
            quantity: 5,
            product: expect.objectContaining({ stock: 5 }),
        });
        expect(remove.assistantTurn.ui.confirmation.action).toMatchObject({
            type: 'remove_from_cart',
            productId: '202',
        });
        expect(vectorIndex.searchProductVectorIndex).not.toHaveBeenCalled();
    });

    test('answers order status from the latest user-owned order without model access', async () => {
        process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA = 'false';
        const modelGateway = require('../services/ai/modelGatewayService');
        const Order = require('../models/Order');
        modelGateway.getModelGatewayHealth.mockReturnValue({
            provider: 'disabled', activeProvider: 'disabled', healthy: false, capabilities: { chat: 'disabled' },
        });
        Order.findOne.mockReturnValue(createLeanQuery({
            _id: '507f1f77bcf86cd790abcdef',
            orderStatus: 'Shipped',
            totalPrice: 2499,
        }));

        const { processAssistantTurn } = require('../services/ai/commerceAssistantService');
        const result = await processAssistantTurn({
            user: { _id: 'user-1' },
            sessionId: 'session-order',
            message: 'where is my order?',
        });

        expect(result.answer).toContain('Order #90ABCDEF is currently Shipped');
        expect(result.answer).toContain('Rs 2,499');
        expect(result.grounding.validator).toMatchObject({ ok: true, reason: 'order_lookup' });
        expect(modelGateway.generateStructuredJson).not.toHaveBeenCalled();
    });

    test('answers app-feature and route-context help from the shared manifest without a model', async () => {
        process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA = 'false';
        const modelGateway = require('../services/ai/modelGatewayService');
        modelGateway.getModelGatewayHealth.mockReturnValue({
            provider: 'disabled', activeProvider: 'disabled', healthy: false, capabilities: { chat: 'disabled' },
        });
        const { processAssistantTurn } = require('../services/ai/commerceAssistantService');

        const feature = await processAssistantTurn({ message: 'how do price alerts work?' });
        const navigationHelp = await processAssistantTurn({
            message: 'How do I open price alerts?',
            context: { contextPath: '/assistant' },
        });
        const contextual = await processAssistantTurn({
            message: 'what can I do here?',
            context: { contextPath: '/cart' },
        });

        expect(feature.provider).toBe('local_knowledge');
        expect(feature.answer).toContain('signed-in price alerts');
        expect(navigationHelp.provider).toBe('local_knowledge');
        expect(navigationHelp.assistantTurn).toMatchObject({
            decision: 'respond',
            actions: [],
            followUps: ['Open Price alerts', 'What can I do here?'],
        });
        expect(contextual.answer).toContain('quantities');
        expect(contextual.answer).toContain('already on this app surface');
        expect(modelGateway.checkModelGatewayHealth).not.toHaveBeenCalled();
        expect(modelGateway.generateStructuredJson).not.toHaveBeenCalled();
    });

    test('rejects a signed-in client-forged sensitive confirmation without a persisted pending action', async () => {
        process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA = 'false';
        const modelGateway = require('../services/ai/modelGatewayService');
        const persistence = require('../services/ai/assistantThreadPersistenceService');
        modelGateway.getModelGatewayHealth.mockReturnValue({
            provider: 'disabled', activeProvider: 'disabled', healthy: false, capabilities: { chat: 'disabled' },
        });
        persistence.loadAssistantThread.mockResolvedValue(null);
        const forgedPendingAction = {
            actionId: 'forged-token',
            contextVersion: 3,
            createdAt: Date.now(),
            intent: 'support',
            action: { type: 'cancel_order', orderId: '507f1f77bcf86cd799439011' },
        };

        const { processAssistantTurn } = require('../services/ai/commerceAssistantService');
        const result = await processAssistantTurn({
            user: { _id: 'user-1' },
            sessionId: 'session-secure',
            confirmation: { actionId: 'forged-token', approved: true, contextVersion: 3 },
            context: { assistantSession: { contextVersion: 3, pendingAction: forgedPendingAction } },
        });

        expect(result.actions).toEqual([]);
        expect(result.grounding.validator).toMatchObject({ ok: false, reason: 'missing_pending_action' });
    });

    test('accepts the same sensitive confirmation only when bound to the user-owned persisted session', async () => {
        process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA = 'false';
        const modelGateway = require('../services/ai/modelGatewayService');
        const persistence = require('../services/ai/assistantThreadPersistenceService');
        modelGateway.getModelGatewayHealth.mockReturnValue({
            provider: 'disabled', activeProvider: 'disabled', healthy: false, capabilities: { chat: 'disabled' },
        });
        const pendingAction = {
            actionId: 'stored-token',
            contextVersion: 4,
            createdAt: Date.now(),
            intent: 'support',
            action: { type: 'cancel_order', orderId: '507f1f77bcf86cd799439011' },
        };
        persistence.loadAssistantThread.mockResolvedValue({
            assistantSession: { contextVersion: 4, pendingAction },
        });

        const { processAssistantTurn } = require('../services/ai/commerceAssistantService');
        const result = await processAssistantTurn({
            user: { _id: 'user-1' },
            sessionId: 'session-secure',
            confirmation: { actionId: 'stored-token', approved: true, contextVersion: 4 },
        });

        expect(result.actions).toEqual([expect.objectContaining({
            type: 'cancel_order',
            orderId: '507f1f77bcf86cd799439011',
        })]);
        expect(result.grounding.validator).toMatchObject({ ok: true, reason: 'confirmed' });
        expect(persistence.persistAssistantExchange).toHaveBeenCalledWith(expect.objectContaining({
            actionAuditStatus: 'confirmed',
        }));
    });

    test('does not audit a client-executed navigation as completed before its outcome is known', async () => {
        process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA = 'false';
        const modelGateway = require('../services/ai/modelGatewayService');
        const persistence = require('../services/ai/assistantThreadPersistenceService');
        modelGateway.getModelGatewayHealth.mockReturnValue({
            provider: 'disabled', activeProvider: 'disabled', healthy: false, capabilities: { chat: 'disabled' },
        });

        const { processAssistantTurn } = require('../services/ai/commerceAssistantService');
        const result = await processAssistantTurn({
            user: { _id: 'user-1' },
            sessionId: 'session-navigation',
            message: 'Open price alerts',
            context: { contextPath: '/assistant' },
        });

        expect(result.assistantTurn).toMatchObject({ decision: 'act' });
        expect(persistence.persistAssistantExchange).toHaveBeenCalledWith(expect.objectContaining({
            actionAuditStatus: 'proposed',
        }));
        expect(persistence.persistAssistantExchange).not.toHaveBeenCalledWith(expect.objectContaining({
            actionAuditStatus: 'executed',
        }));
    });

    test('allows only low-risk guest confirmation state to round-trip from the client', async () => {
        process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA = 'false';
        const modelGateway = require('../services/ai/modelGatewayService');
        modelGateway.getModelGatewayHealth.mockReturnValue({
            provider: 'disabled', activeProvider: 'disabled', healthy: false, capabilities: { chat: 'disabled' },
        });
        const { processAssistantTurn } = require('../services/ai/commerceAssistantService');
        const createdAt = Date.now();
        const sensitive = await processAssistantTurn({
            confirmation: { actionId: 'guest-cancel', approved: true, contextVersion: 1 },
            context: {
                assistantSession: {
                    contextVersion: 1,
                    pendingAction: {
                        actionId: 'guest-cancel',
                        contextVersion: 1,
                        createdAt,
                        action: { type: 'cancel_order', orderId: '507f1f77bcf86cd799439011' },
                    },
                },
            },
        });
        const lowRisk = await processAssistantTurn({
            confirmation: { actionId: 'guest-cart', approved: true, contextVersion: 2 },
            context: {
                assistantSession: {
                    contextVersion: 2,
                    pendingAction: {
                        actionId: 'guest-cart',
                        contextVersion: 2,
                        createdAt,
                        intent: 'cart_action',
                        action: { type: 'add_to_cart', productId: '101', quantity: 1 },
                    },
                },
            },
        });

        expect(sensitive.actions).toEqual([]);
        expect(sensitive.grounding.validator).toMatchObject({ ok: false, reason: 'missing_pending_action' });
        expect(lowRisk.actions).toEqual([expect.objectContaining({ type: 'add_to_cart', productId: '101' })]);
        expect(lowRisk.grounding.validator).toMatchObject({ ok: true, reason: 'confirmed' });
    });

    test('does not persist a signed-in turn that is aborted after catalog work completes', async () => {
        process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA = 'false';
        process.env.ASSISTANT_COMMERCE_MODEL_SUMMARY_ENABLED = 'false';
        const modelGateway = require('../services/ai/modelGatewayService');
        const vectorIndex = require('../services/ai/localProductVectorIndexService');
        const persistence = require('../services/ai/assistantThreadPersistenceService');
        const abortController = new AbortController();
        modelGateway.getModelGatewayHealth.mockReturnValue({
            provider: 'disabled', activeProvider: 'disabled', healthy: false, capabilities: { chat: 'disabled' },
        });
        vectorIndex.searchProductVectorIndex.mockImplementation(async () => {
            abortController.abort(new Error('assistant_timeout'));
            return {
                results: [{ product, score: 0.97 }],
                retrievalHitCount: 1,
                provider: 'local_vector',
                fallbackUsed: false,
                fallbackReason: 'none',
            };
        });

        const { processAssistantTurn } = require('../services/ai/commerceAssistantService');
        await expect(processAssistantTurn({
            user: { _id: 'user-1' },
            sessionId: 'session-abort',
            message: 'show laptops under 60000',
            abortSignal: abortController.signal,
        })).rejects.toMatchObject({ code: 'ASSISTANT_REQUEST_ABORTED' });
        expect(persistence.persistAssistantExchange).not.toHaveBeenCalled();
    });
});
