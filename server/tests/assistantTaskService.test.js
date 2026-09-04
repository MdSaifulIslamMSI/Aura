const { advanceTask, missingSlots } = require('../services/ai/assistantTaskService');

const stubDeps = (overrides = {}) => ({
    parseQuantity: () => 1,
    resolveReference: () => null,
    resolveOrder: async () => null,
    ...overrides,
});

describe('assistantTaskService', () => {
    test('completes add_to_cart when memory resolves the reference', async () => {
        const result = await advanceTask({
            message: 'add the second one to cart',
            taskType: 'add_to_cart',
            assistantSession: {},
            deps: stubDeps({
                resolveReference: () => ({ productId: '202', how: 'ordinal' }),
                parseQuantity: () => 2,
            }),
        });

        expect(result.complete).toBe(true);
        expect(result.action).toMatchObject({ type: 'add_to_cart', productId: '202', quantity: 2 });
        expect(result.taskState).toBeNull();
    });

    test('asks for the missing product slot and keeps task state', async () => {
        const result = await advanceTask({
            message: 'add it to cart',
            taskType: 'add_to_cart',
            assistantSession: {},
            deps: stubDeps(),
        });

        expect(result.complete).toBe(false);
        expect(result.question).toBe('productId');
        expect(result.taskState).toMatchObject({ taskType: 'add_to_cart', slots: { quantity: 1 } });
        expect(missingSlots(result.taskState)).toEqual(['productId']);
    });

    test('continues a pending task across turns', async () => {
        const first = await advanceTask({
            message: 'cancel my order',
            taskType: 'cancel_order',
            assistantSession: {},
            deps: stubDeps(),
        });
        expect(first.question).toBe('orderId');

        const second = await advanceTask({
            message: 'the latest one',
            assistantSession: { pendingTask: first.taskState },
            deps: stubDeps({ resolveOrder: async () => ({ orderId: '507f1f77bcf86cd799439011' }) }),
        });
        expect(second.complete).toBe(true);
        expect(second.action).toMatchObject({ type: 'cancel_order', orderId: '507f1f77bcf86cd799439011' });
    });

    test('detects return request type from language', async () => {
        const result = await advanceTask({
            message: 'i want to replace my order',
            taskType: 'create_return_request',
            assistantSession: {},
            deps: stubDeps({ resolveOrder: async () => ({ orderId: '507f1f77bcf86cd799439011' }) }),
        });
        expect(result.complete).toBe(true);
        expect(result.action).toMatchObject({ type: 'create_return_request', requestType: 'replacement' });
    });

    test('blocked order resolution ends the task with a message', async () => {
        const result = await advanceTask({
            message: 'cancel my order',
            taskType: 'cancel_order',
            assistantSession: {},
            deps: stubDeps({ resolveOrder: async () => ({ blocked: 'Sign in before I look up orders.' }) }),
        });
        expect(result.taskState).toBeNull();
        expect(result.question).toBe('Sign in before I look up orders.');
    });

    test('cancel words abandon the pending task', async () => {
        const result = await advanceTask({
            message: 'never mind',
            assistantSession: { pendingTask: { taskType: 'add_to_cart', slots: {}, asked: ['productId'], createdAt: Date.now() } },
            deps: stubDeps(),
        });
        expect(result.cancelled).toBe(true);
        expect(result.taskState).toBeNull();
    });
});
