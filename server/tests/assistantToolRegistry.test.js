const {
    getToolDefinition,
    validateAssistantAction,
    validateToolInput,
} = require('../services/ai/assistantToolRegistry');

describe('assistantToolRegistry', () => {
    test('validates registered tool inputs against the strict contract', () => {
        expect(getToolDefinition('search_products')).toMatchObject({
            name: 'search_products',
            mutation: false,
        });
        expect(validateToolInput({
            toolName: 'search_products',
            payload: {
                query: 'laptops under 70000',
                filters: {
                    category: 'laptops',
                },
            },
        })).toMatchObject({ ok: true });
    });

    test('rejects missing required fields', () => {
        expect(validateToolInput({
            toolName: 'add_to_cart',
            payload: {
                quantity: 1,
            },
        })).toMatchObject({
            ok: false,
            reason: 'missing_required_input:productId',
        });
    });

    test('blocks disabled tools before execution', () => {
        expect(validateAssistantAction(
            { type: 'navigate_to', page: 'checkout' },
            { disabledTools: ['navigate_to'] },
        )).toMatchObject({
            ok: false,
            reason: 'tool_disabled_by_override',
        });
    });
});
