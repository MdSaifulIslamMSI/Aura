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

    test('registers live commerce tools without making them hallucination fields', () => {
        expect(getToolDefinition('check_inventory')).toMatchObject({
            mutation: false,
            input_schema: {
                required: ['productId'],
            },
        });
        expect(getToolDefinition('cancel_order')).toMatchObject({
            mutation: true,
            requires_confirmation: true,
        });
        expect(validateAssistantAction({
            type: 'apply_coupon',
            couponCode: 'AURA10',
        })).toMatchObject({ ok: true });
    });

    test('rejects semantically unsafe navigation, quantity, and order identifiers', () => {
        expect(validateAssistantAction({
            type: 'navigate_to',
            page: 'admin',
        })).toMatchObject({ ok: false, reason: 'invalid_input_value:page' });
        expect(validateAssistantAction({
            type: 'add_to_cart',
            productId: '101',
            quantity: 21,
        })).toMatchObject({ ok: false, reason: 'invalid_input_value:quantity' });
        expect(validateAssistantAction({
            type: 'cancel_order',
            orderId: '90ABCDEF',
        })).toMatchObject({ ok: false, reason: 'invalid_input_value:orderId' });
    });

    test('requires dynamic navigation context and accepts known manifest pages', () => {
        expect(validateAssistantAction({
            type: 'navigate_to',
            page: 'seller_profile',
            params: {},
        })).toMatchObject({ ok: false, reason: 'invalid_input_value:sellerId' });
        expect(validateAssistantAction({
            type: 'navigate_to',
            page: 'price_alerts',
            params: {},
        })).toMatchObject({ ok: true });
    });
});
