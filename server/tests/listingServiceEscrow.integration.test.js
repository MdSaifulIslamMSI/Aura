const PaymentEvent = require('../models/PaymentEvent');
const {
  appendEscrowPaymentEvent,
  assertEscrowEligibility,
} = require('../services/listingService');

describe('listingService escrow integration', () => {
  test('persists auditable payment events with content hashes', async () => {
    await appendEscrowPaymentEvent({ intentId: 'pi-esc-1', source: 'webhook', type: 'captured', payload: { amount: 500 } });
    const stored = await PaymentEvent.findOne({ intentId: 'pi-esc-1' });
    expect(stored).toMatchObject({ source: 'webhook', type: 'captured' });
    expect(stored.payloadHash).toMatch(/^[0-9a-f]{8}$/);
  });

  test('enforces real eligibility transitions', () => {
    const listing = { status: 'active', escrowOptIn: true, seller: 'seller-1', escrow: { state: 'none' } };
    expect(() => assertEscrowEligibility({ listing, userId: 'buyer-1' })).not.toThrow();
    expect(() => assertEscrowEligibility({
      listing: { ...listing, escrow: { state: 'held' } }, userId: 'buyer-1',
    })).toThrow('Escrow is already active for this listing');
  });
});
