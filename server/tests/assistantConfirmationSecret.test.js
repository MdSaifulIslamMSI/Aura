const crypto = require('crypto');
const {
    buildConfirmationToken,
    verifyConfirmationToken,
} = require('../services/ai/assistantContract');

const ACTION = {
    type: 'add_to_cart',
    productId: 'product-1',
    quantity: 1,
};

const legacyToken = (action) => crypto
    .createHash('sha256')
    .update(JSON.stringify({
        type: String(action?.type || ''),
        productId: String(action?.productId || ''),
        productIds: [],
        query: '',
        page: '',
        orderId: '',
        couponCode: '',
        requestType: '',
        quantity: Number(action?.quantity) || 0,
        amount: 0,
        reason: '',
        filters: {},
        params: {},
        prefill: null,
    }))
    .digest('hex')
    .slice(0, 16);

describe('assistant confirmation secret handling', () => {
    const original = {
        NODE_ENV: process.env.NODE_ENV,
        ASSISTANT_CONFIRMATION_SECRET: process.env.ASSISTANT_CONFIRMATION_SECRET,
        ASSISTANT_CONFIRMATION_SECRET_PREV: process.env.ASSISTANT_CONFIRMATION_SECRET_PREV,
        AI_INTERNAL_TOOL_SECRET: process.env.AI_INTERNAL_TOOL_SECRET,
    };

    afterEach(() => {
        process.env.NODE_ENV = original.NODE_ENV;
        process.env.ASSISTANT_CONFIRMATION_SECRET = original.ASSISTANT_CONFIRMATION_SECRET;
        process.env.ASSISTANT_CONFIRMATION_SECRET_PREV = original.ASSISTANT_CONFIRMATION_SECRET_PREV;
        process.env.AI_INTERNAL_TOOL_SECRET = original.AI_INTERNAL_TOOL_SECRET;
    });

    test('production does not fall back to the internal-tool secret', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.ASSISTANT_CONFIRMATION_SECRET;
        delete process.env.ASSISTANT_CONFIRMATION_SECRET_PREV;
        process.env.AI_INTERNAL_TOOL_SECRET = 'internal-tool-secret';

        const token = buildConfirmationToken(ACTION);

        expect(token).toBe('');
        expect(verifyConfirmationToken(ACTION, legacyToken(ACTION))).toBe(false);
    });

    test('production signs and verifies with the dedicated secret', () => {
        process.env.NODE_ENV = 'production';
        process.env.ASSISTANT_CONFIRMATION_SECRET = 'confirmation-secret';
        delete process.env.ASSISTANT_CONFIRMATION_SECRET_PREV;
        delete process.env.AI_INTERNAL_TOOL_SECRET;

        const token = buildConfirmationToken(ACTION);

        expect(token).toMatch(/^[a-f0-9]{32}$/);
        expect(verifyConfirmationToken(ACTION, token)).toBe(true);
        expect(verifyConfirmationToken({ ...ACTION, quantity: 2 }, token)).toBe(false);
    });

    test('development keeps the legacy fallback for local workflows', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.ASSISTANT_CONFIRMATION_SECRET;
        delete process.env.ASSISTANT_CONFIRMATION_SECRET_PREV;
        delete process.env.AI_INTERNAL_TOOL_SECRET;

        const token = buildConfirmationToken(ACTION);

        expect(token).toBe(legacyToken(ACTION));
        expect(verifyConfirmationToken(ACTION, token)).toBe(true);
    });
});
