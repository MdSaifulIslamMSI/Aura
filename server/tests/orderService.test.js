const {
  appendOrderStatusEvent,
  createCommandId,
  DIGITAL_PAYMENT_METHODS,
  normalizeCommandCenter,
  resolveOrderItemForCommand,
} = require('../services/orderService');

describe('orderService.normalizeCommandCenter', () => {
  test('defaults every collection to an empty array', () => {
    expect(normalizeCommandCenter(null)).toEqual({
      refunds: [], replacements: [], supportChats: [], warrantyClaims: [], lastUpdatedAt: null,
    });
  });

  test('preserves existing command arrays', () => {
    const order = { commandCenter: { refunds: [{ id: 'r1' }], lastUpdatedAt: '2026-01-01' } };
    const normalized = normalizeCommandCenter(order);
    expect(normalized.refunds).toHaveLength(1);
    expect(normalized.replacements).toEqual([]);
    expect(normalized.lastUpdatedAt).toBe('2026-01-01');
  });

  test('coerces non-array values to empty arrays', () => {
    expect(normalizeCommandCenter({ commandCenter: { refunds: 'nope' } }).refunds).toEqual([]);
  });
});

describe('orderService.createCommandId', () => {
  test('prefixes ids and keeps them unique', () => {
    const first = createCommandId();
    const second = createCommandId();
    expect(first).toMatch(/^cmd-\d+-/);
    expect(first).not.toBe(second);
  });

  test('honors custom prefixes', () => {
    expect(createCommandId('refund')).toMatch(/^refund-/);
  });
});

describe('orderService.appendOrderStatusEvent', () => {
  test('appends timeline events with actor and timestamp', () => {
    const order = { orderStatus: 'shipped', statusTimeline: [] };
    appendOrderStatusEvent(order, { message: '  Left warehouse ', actor: 'admin' });
    expect(order.statusTimeline).toHaveLength(1);
    expect(order.statusTimeline[0]).toMatchObject({ status: 'shipped', message: 'Left warehouse', actor: 'admin' });
    expect(order.statusTimeline[0].at).toBeInstanceOf(Date);
  });

  test('initializes the timeline when missing and defaults the actor', () => {
    const order = {};
    appendOrderStatusEvent(order, { status: 'placed', message: 'hi' });
    expect(order.statusTimeline[0]).toMatchObject({ status: 'placed', actor: 'system' });
  });

  test('falls back to the order status when no status is given', () => {
    const order = { orderStatus: 'delivered' };
    appendOrderStatusEvent(order, { message: 'done' });
    expect(order.statusTimeline[0].status).toBe('delivered');
  });
});

describe('orderService.resolveOrderItemForCommand', () => {
  const order = {
    orderItems: [
      { product: 'p-1', title: 'Aura Phone' },
      { product: 'p-2', title: 'Aura Buds' },
    ],
  };

  test('returns null for empty orders', () => {
    expect(resolveOrderItemForCommand({ orderItems: [] }, {})).toBeNull();
    expect(resolveOrderItemForCommand({}, {})).toBeNull();
  });

  test('resolves by product id first', () => {
    expect(resolveOrderItemForCommand(order, { itemProductId: 'p-2' }).title).toBe('Aura Buds');
  });

  test('resolves by title case-insensitively', () => {
    expect(resolveOrderItemForCommand(order, { itemTitle: '  AURA PHONE ' }).product).toBe('p-1');
  });

  test('falls back to the first item when nothing matches', () => {
    expect(resolveOrderItemForCommand(order, { itemProductId: 'unknown' }).product).toBe('p-1');
    expect(resolveOrderItemForCommand(order, {}).product).toBe('p-1');
  });

  test('supports legacy productId item shape', () => {
    const legacy = { orderItems: [{ productId: 42, title: 'Legacy' }] };
    expect(resolveOrderItemForCommand(legacy, { itemProductId: 42 }).title).toBe('Legacy');
  });
});

describe('orderService.DIGITAL_PAYMENT_METHODS', () => {
  test('flags digital rails for payment-intent flows', () => {
    expect(DIGITAL_PAYMENT_METHODS.has('CARD')).toBe(true);
    expect(DIGITAL_PAYMENT_METHODS.has('UPI')).toBe(true);
    expect(DIGITAL_PAYMENT_METHODS.has('COD')).toBe(false);
  });
});
