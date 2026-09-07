jest.mock('../services/socketService', () => ({ sendMessageToUser: jest.fn() }));

const { sendMessageToUser } = require('../services/socketService');
const {
  buildCartRealtimePayload,
  emitCartRealtimeUpdate,
} = require('../services/cartRealtimeService');

describe('cartRealtimeService.buildCartRealtimePayload', () => {
  test('returns null without a cart or user', () => {
    expect(buildCartRealtimePayload({})).toBeNull();
    expect(buildCartRealtimePayload({ cart: { items: [] } })).toBeNull();
    expect(buildCartRealtimePayload({ authUid: 'u-1' })).toBeNull();
  });

  test('builds versioned cart payloads', () => {
    const payload = buildCartRealtimePayload({
      authUid: 'u-1',
      cart: { items: [{ id: 1 }], version: 4, updatedAt: '2026-09-01', summary: { total: 100 } },
      reason: 'item_added',
      requestId: 'req-1',
    });
    expect(payload).toMatchObject({
      entity: 'cart', source: 'user', userId: 'u-1', revision: 4,
      reason: 'item_added', requestId: 'req-1', provider: 'canonical_cart',
    });
    expect(payload.items).toHaveLength(1);
    expect(payload.emittedAt).toEqual(expect.any(String));
  });

  test('defaults reason and provider', () => {
    const payload = buildCartRealtimePayload({ authUid: 'u-1', cart: { items: [] } });
    expect(payload.reason).toBe('updated');
    expect(payload.provider).toBe('canonical_cart');
  });
});

describe('cartRealtimeService.emitCartRealtimeUpdate', () => {
  beforeEach(() => jest.clearAllMocks());

  test('emits to the socket user with the built payload', () => {
    const ok = emitCartRealtimeUpdate({
      socketUserId: 'sock-1', authUid: 'u-1', cart: { items: [] }, reason: 'checkout',
    });
    expect(ok).toBe(true);
    expect(sendMessageToUser).toHaveBeenCalledWith('sock-1', 'cart.updated', expect.objectContaining({
      entity: 'cart', reason: 'checkout',
    }));
  });

  test('refuses to emit without a socket target or payload', () => {
    expect(emitCartRealtimeUpdate({ authUid: 'u-1', cart: { items: [] } })).toBe(false);
    expect(emitCartRealtimeUpdate({ socketUserId: 'sock-1', cart: null })).toBe(false);
    expect(sendMessageToUser).not.toHaveBeenCalled();
  });
});
