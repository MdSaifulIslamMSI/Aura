jest.mock('../models/Product', () => ({
    findOne: jest.fn(() => ({
        select: jest.fn(() => ({
            lean: jest.fn(async () => ({
                id: 202,
                title: 'Prime Phone Lite',
                brand: 'Prime',
                category: 'Mobiles',
                price: 22000,
                stock: 9,
                rating: 4.6,
                ratingCount: 200,
            })),
        })),
    })),
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
    getGatewayConfig: jest.fn(() => ({ embedModel: 'test-embed' })),
    getModelGatewayHealth: jest.fn(() => ({ healthy: false, provider: 'disabled' })),
}));

jest.mock('../services/ai/localProductVectorIndexService', () => ({
    getLocalVectorIndexHealth: jest.fn(async () => ({ healthy: false })),
    searchProductVectorIndex: jest.fn(async () => ({ results: [], retrievalHitCount: 0 })),
}));

const { processAssistantTurn, __testables } = require('../services/ai/commerceAssistantService');

const guestSession = (overrides = {}) => ({
    contextVersion: 1,
    lastIntent: 'product_search',
    lastResults: [
        { id: '101', title: 'Aura Phone Pro', brand: 'Aura', category: 'Mobiles', price: 45000, stock: 3, rating: 4.2 },
        { id: '202', title: 'Prime Phone Lite', brand: 'Prime', category: 'Mobiles', price: 22000, stock: 9, rating: 4.6 },
    ],
    activeProduct: null,
    pendingAction: null,
    pendingTask: null,
    ...overrides,
});

describe('assistant multi-turn tasks', () => {
    test('ambiguous reference asks which one and stores pendingTask', async () => {
        const result = await processAssistantTurn({
            user: null,
            message: 'add it to cart',
            context: { assistantSession: guestSession() },
        });

        expect(result.assistantTurn.decision).toBe('clarify');
        expect(result.grounding.validator).toMatchObject({ ok: false, reason: 'task_slot_needed' });
        expect(result.assistantSession.pendingTask).toMatchObject({ taskType: 'add_to_cart' });
        expect(result.assistantTurn.response).toMatch(/Which one/);
    });

    test('pending task routes follow-ups to ACTION and completes on option pick', async () => {
        const pending = {
            taskType: 'add_to_cart',
            slots: { quantity: 1 },
            asked: ['productId'],
            createdAt: Date.now(),
        };
        expect(__testables.detectRoute({
            message: 'the second one',
            assistantSession: guestSession({ pendingTask: pending }),
        })).toMatchObject({ route: 'ACTION', reason: 'pending_task' });

        const result = await processAssistantTurn({
            user: null,
            message: 'the second one',
            context: { assistantSession: guestSession({ pendingTask: pending }) },
        });

        expect(result.assistantTurn.ui.confirmation).toBeTruthy();
        expect(result.assistantTurn.ui.confirmation.action).toMatchObject({
            type: 'add_to_cart',
            productId: '202',
            quantity: 1,
        });
        expect(result.assistantSession.pendingTask).toBeNull();
    });

    test('never mind abandons the task', async () => {
        const pending = { taskType: 'add_to_cart', slots: {}, asked: ['productId'], createdAt: Date.now() };
        const result = await processAssistantTurn({
            user: null,
            message: 'never mind',
            context: { assistantSession: guestSession({ pendingTask: pending }) },
        });

        expect(result.grounding.validator).toMatchObject({ ok: true, reason: 'task_cancelled' });
        expect(result.assistantSession.pendingTask).toBeNull();
    });

    test('memory resolution prefers session results over client hints', async () => {
        const pending = { taskType: 'add_to_cart', slots: {}, asked: [], createdAt: Date.now() };
        const result = await processAssistantTurn({
            user: null,
            message: 'add the cheaper one to cart',
            context: {
                currentProductId: '999',
                assistantSession: guestSession({ pendingTask: pending }),
            },
        });

        expect(result.assistantTurn.ui.confirmation.action).toMatchObject({ productId: '202' });
    });
});

describe('needsAgentReasoning', () => {
    test('engages for references, comparisons, and refinements only', () => {
        const session = guestSession();
        expect(__testables.needsAgentReasoning({ message: 'add the second one', assistantSession: session, context: {} })).toBe(true);
        expect(__testables.needsAgentReasoning({
            message: 'compare these two',
            assistantSession: session,
            context: { candidateProductIds: ['101', '202'] },
        })).toBe(true);
        expect(__testables.needsAgentReasoning({ message: 'show me phones', assistantSession: {}, context: {} })).toBe(false);
        expect(__testables.needsAgentReasoning({ message: '', assistantSession: session, context: {} })).toBe(false);
    });
});
