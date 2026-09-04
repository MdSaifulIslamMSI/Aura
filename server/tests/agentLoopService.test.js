const { AGENT_LOOP_TOOLS, AGENT_MAX_ITERATIONS, isAgentLoopEnabled, runAgentLoop } = require('../services/ai/agentLoopService');

const product = (overrides = {}) => ({
    id: '101',
    title: 'Aura Phone',
    brand: 'Aura',
    category: 'Mobiles',
    price: 9999,
    stock: 5,
    rating: 4.5,
    ratingCount: 120,
    ...overrides,
});

const stubProductModel = (docs = []) => ({
    findOne: jest.fn(() => ({
        select: jest.fn(() => ({
            lean: jest.fn(async () => docs[0] || null),
        })),
    })),
    find: jest.fn(() => ({
        select: jest.fn(() => ({
            lean: jest.fn(async () => docs),
        })),
    })),
});

const stubDeps = (overrides = {}) => ({
    generateStructuredJson: jest.fn(),
    validateAssistantAction: jest.fn(() => ({ ok: true })),
    searchProductVectorIndex: jest.fn(async () => ({ results: [] })),
    Product: stubProductModel(),
    ...overrides,
});

describe('agentLoopService', () => {
    test('searches then answers only with observed ids', async () => {
        const deps = stubDeps({
            searchProductVectorIndex: jest.fn(async () => ({ results: [{ product: product() }] })),
        });
        deps.generateStructuredJson
            .mockResolvedValueOnce({ data: { thought: 'need catalog', tool_calls: [{ type: 'search_products', query: 'phones' }] }, provider: 'test', providerModel: 'm' })
            .mockResolvedValueOnce({ data: { answer: 'Aura Phone at Rs.9999.', productIds: ['101', '999'], followUps: ['Compare'] }, provider: 'test', providerModel: 'm' });

        const result = await runAgentLoop({ message: 'phones', filters: {}, deps });

        expect(result.answer).toBe('Aura Phone at Rs.9999.');
        expect(result.productIds).toEqual(['101']);
        expect(result.iterations).toBe(2);
        expect(result.toolRuns).toHaveLength(1);
        expect(deps.searchProductVectorIndex).toHaveBeenCalledTimes(1);
    });

    test('rejects forbidden mutation tools without executing', async () => {
        const deps = stubDeps();
        deps.generateStructuredJson
            .mockResolvedValueOnce({ data: { tool_calls: [{ type: 'add_to_cart', productId: '101' }] }, provider: 't', providerModel: 'm' })
            .mockResolvedValueOnce({ data: { answer: 'Done.', productIds: [] }, provider: 't', providerModel: 'm' });

        const result = await runAgentLoop({ message: 'buy it', filters: {}, deps });

        expect(result.toolRuns[0]).toMatchObject({ toolName: 'add_to_cart', status: 'failed' });
        expect(result.answer).toBe('Done.');
    });

    test('returns proposedAction for confirmation instead of executing', async () => {
        const deps = stubDeps();
        deps.generateStructuredJson.mockResolvedValueOnce({
            data: { answer: 'Ready to add.', productIds: [], proposedAction: { type: 'add_to_cart', productId: '101', quantity: 1 } },
            provider: 't',
            providerModel: 'm',
        });

        const result = await runAgentLoop({ message: 'add it', filters: {}, deps });

        expect(result.proposedAction).toMatchObject({ type: 'add_to_cart', productId: '101' });
    });

    test('closes out deterministically when the model never answers', async () => {
        const deps = stubDeps({
            searchProductVectorIndex: jest.fn(async () => ({ results: [{ product: product() }] })),
        });
        deps.generateStructuredJson.mockResolvedValue({
            data: { thought: 'looping', tool_calls: [{ type: 'search_products', query: 'x' }] },
            provider: 't',
            providerModel: 'm',
        });

        const result = await runAgentLoop({ message: 'x', filters: {}, deps });

        expect(result.iterations).toBe(AGENT_MAX_ITERATIONS);
        expect(result.productIds).toEqual(['101']);
        expect(result.answer).toMatch(/verified these catalog matches/);
    });

    test('emits tool_start/tool_end progress events', async () => {
        const events = [];
        const deps = stubDeps();
        deps.generateStructuredJson.mockResolvedValueOnce({
            data: { tool_calls: [{ type: 'get_price', productId: '101' }], answer: 'Rs.9999.', productIds: ['101'] },
            provider: 't',
            providerModel: 'm',
        });

        await runAgentLoop({ message: 'price?', filters: {}, deps, onEvent: (event) => events.push(event.type) });

        expect(events).toEqual(['tool_start', 'tool_end']);
    });

    test('aborts on request', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(runAgentLoop({ message: 'x', filters: {}, deps: stubDeps(), abortSignal: controller.signal }))
            .rejects.toMatchObject({ code: 'ASSISTANT_REQUEST_ABORTED' });
    });

    test('exposes loop tool allowlist without mutations', () => {
        expect(AGENT_LOOP_TOOLS).not.toEqual(expect.arrayContaining(['add_to_cart', 'cancel_order', 'go_to_checkout']));
        expect(typeof isAgentLoopEnabled()).toBe('boolean');
    });
});
