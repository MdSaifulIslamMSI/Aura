jest.mock('../services/socketService', () => ({
    sendMessageToUser: jest.fn(),
}));

const {
    buildCartRealtimePayload,
    emitCartRealtimeUpdate,
} = require('../services/cartRealtimeService');
const { sendMessageToUser } = require('../services/socketService');

describe('cartRealtimeService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('buildCartRealtimePayload normalizes a canonical cart snapshot for authenticated clients', () => {
        const payload = buildCartRealtimePayload({
            authUid: 'firebase-user-1',
            reason: 'checkout_cart_cleared',
            requestId: 'req-1',
            cart: {
                version: 7,
                updatedAt: '2026-04-06T10:00:00.000Z',
                items: [{ productId: 11, quantity: 1 }],
                summary: { totalQuantity: 1 },
            },
        });

        expect(payload).toMatchObject({
            entity: 'cart',
            source: 'user',
            userId: 'firebase-user-1',
            revision: 7,
            syncedAt: '2026-04-06T10:00:00.000Z',
            reason: 'checkout_cart_cleared',
            requestId: 'req-1',
        });
        expect(payload.items).toEqual([{ productId: 11, quantity: 1 }]);
    });

    test('emitCartRealtimeUpdate sends a socket event only when the cart and identities are present', () => {
        const emitted = emitCartRealtimeUpdate({
            socketUserId: 'mongo-user-1',
            authUid: 'firebase-user-1',
            reason: 'cart_commands_applied',
            requestId: 'req-2',
            cart: {
                version: 8,
                updatedAt: '2026-04-06T10:05:00.000Z',
                items: [{ productId: 22, quantity: 2 }],
                summary: { totalQuantity: 2 },
            },
        });

        expect(emitted).toBe(true);
        expect(sendMessageToUser).toHaveBeenCalledWith(
            'mongo-user-1',
            'cart.updated',
            expect.objectContaining({
                userId: 'firebase-user-1',
                revision: 8,
                reason: 'cart_commands_applied',
            }),
        );
    });
});
