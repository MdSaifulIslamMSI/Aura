jest.mock('../models/Order', () => ({}));

const createLeanQuery = (result) => ({
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
});

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
    };

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA = 'true';
    });

    afterEach(() => {
        delete process.env.ASSISTANT_COMMERCE_REQUIRE_HOSTED_GEMMA;
    });

    test('returns a strict hosted-Gemma unavailable response when the gateway is down', async () => {
        const modelGateway = require('../services/ai/modelGatewayService');
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

        const { processAssistantTurn } = require('../services/ai/commerceAssistantService');
        const result = await processAssistantTurn({
            message: 'show me phones under 30000',
        });

        expect(result.route).toBe('ECOMMERCE_SEARCH');
        expect(result.provider).toBe('gemini');
        expect(result.answer).toContain('Hosted Gemma commerce reasoning is temporarily unavailable');
        expect(result.grounding.validator).toMatchObject({
            ok: false,
            reason: 'hosted_gemma_gateway_unavailable',
            requiredProvider: 'gemini',
        });
        expect(result.products).toEqual([]);
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
});
