jest.mock('../services/email', () => ({ sendTransactionalEmail: jest.fn() }));
jest.mock('../models/PaymentEvent', () => ({ create: jest.fn() }));

const AppError = require('../utils/AppError');
const { sendTransactionalEmail } = require('../services/email');
const PaymentEvent = require('../models/PaymentEvent');
const {
  appendEscrowPaymentEvent,
  assertEscrowEligibility,
  buildEscrowCheckoutPayload,
  SELLER_PRIVATE_THREAD,
  SELLER_PUBLIC_STRICT,
  sendCounterpartyMessageEmail,
  serializeThreadForUser,
} = require('../services/listingService');

describe('listingService.assertEscrowEligibility', () => {
  const eligible = { status: 'active', escrowOptIn: true, seller: 'seller-1', escrow: { state: 'none' } };

  test('passes for an eligible listing', () => {
    expect(() => assertEscrowEligibility({ listing: eligible, userId: 'buyer-1' })).not.toThrow();
  });

  test.each([
    ['missing listing', null, 'buyer-1', 404],
    ['inactive listing', { ...eligible, status: 'sold' }, 'buyer-1', 409],
    ['escrow not enabled', { ...eligible, escrowOptIn: false }, 'buyer-1', 409],
    ['own listing', eligible, 'seller-1', 403],
    ['already held', { ...eligible, escrow: { state: 'held' } }, 'buyer-1', 409],
  ])('rejects %s', (_label, listing, userId, statusCode) => {
    try {
      assertEscrowEligibility({ listing, userId });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(statusCode);
    }
  });

  test('allows held escrow when explicitly permitted', () => {
    expect(() => assertEscrowEligibility({
      listing: { ...eligible, escrow: { state: 'held' } },
      userId: 'buyer-1',
      allowHeld: true,
    })).not.toThrow();
  });
});

describe('listingService.serializeThreadForUser', () => {
  const listing = { seller: { _id: 'seller-1' }, title: 'Bike' };
  const thread = { buyer: 'buyer-1', unreadBySeller: 2, unreadByBuyer: 5, messages: [{ text: 'hi' }] };

  test('exposes the seller unread count to the seller', () => {
    const view = serializeThreadForUser({ listing, thread, viewerId: 'seller-1' });
    expect(view.unreadCount).toBe(2);
  });

  test('exposes the buyer unread count to the buyer', () => {
    const view = serializeThreadForUser({ listing, thread, viewerId: 'buyer-1' });
    expect(view.unreadCount).toBe(5);
  });

  test('supports plain seller id references', () => {
    const view = serializeThreadForUser({ listing: { seller: 'seller-1' }, thread, viewerId: 'seller-1' });
    expect(view.unreadCount).toBe(2);
  });
});

describe('listingService.buildEscrowCheckoutPayload', () => {
  test('builds a razorpay checkout payload', () => {
    const payload = buildEscrowCheckoutPayload({
      providerOrderId: 'order_123', amount: 50000, currency: 'INR', user: { email: 'b@example.com' },
    });
    expect(payload).toMatchObject({ orderId: 'order_123', amount: 50000 });
    expect(payload.key).toEqual(expect.any(String));
  });
});

describe('listingService.sendCounterpartyMessageEmail', () => {
  beforeEach(() => jest.clearAllMocks());

  test('skips invalid recipient emails silently', async () => {
    await sendCounterpartyMessageEmail({ recipientEmail: 'not-an-email', messageText: 'hi', listing: {} });
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  test('sends templated mail for valid recipients', async () => {
    sendTransactionalEmail.mockResolvedValue({ accepted: true });
    await sendCounterpartyMessageEmail({
      recipientEmail: 'buyer@example.com', recipientName: 'Buyer', actorName: 'Seller',
      listing: { title: 'Bike' }, messageText: 'Is this available?',
      req: { requestId: 'req-1', method: 'POST', originalUrl: '/api/listings/x/messages', headers: {}, ip: '127.0.0.1' },
    });
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
  });
});

describe('listingService.appendEscrowPaymentEvent', () => {
  test('persists hashed payment events for the audit trail', async () => {
    PaymentEvent.create.mockResolvedValue({ eventId: 'evt-1' });
    await appendEscrowPaymentEvent({ intentId: 'pi-1', source: 'webhook', type: 'captured', payload: { a: 1 } });
    expect(PaymentEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      intentId: 'pi-1', source: 'webhook', type: 'captured', payloadHash: expect.any(String),
    }));
  });
});

describe('listingService thread visibility constants', () => {
  test('exposes strict and private thread projections', () => {
    expect(SELLER_PUBLIC_STRICT).toBeDefined();
    expect(SELLER_PRIVATE_THREAD).toBeDefined();
  });
});
