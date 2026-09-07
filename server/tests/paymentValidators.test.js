const {
  completeChallengeSchema,
  confirmIntentSchema,
  createIntentSchema,
  getIntentSchema,
  methodIdParamSchema,
  paymentMethodSchema,
  paymentMethodSetupIntentSchema,
  refundSchema,
} = require('../validators/paymentValidators');

const validQuote = {
  quotePayload: { items: [] },
  quoteSnapshot: { totalPrice: 5000, baseCurrency: 'INR', displayAmount: 60, displayCurrency: 'USD' },
  paymentMethod: 'UPI',
};

describe('paymentValidators intent schemas', () => {
  test('create accepts full checkout quotes', () => {
    expect(() => createIntentSchema.parse({ body: validQuote })).not.toThrow();
  });

  test('create rejects non-positive totals', () => {
    expect(createIntentSchema.safeParse({
      body: { ...validQuote, quoteSnapshot: { totalPrice: -5 } },
    }).success).toBe(false);
  });

  test('confirm requires provider payment references', () => {
    expect(() => confirmIntentSchema.parse({
      params: { intentId: 'pi_123456' },
      body: { providerPaymentId: 'pay_1', providerOrderId: 'order_1', providerSignature: 'sig123' },
    })).not.toThrow();
    expect(confirmIntentSchema.safeParse({ params: { intentId: 'x' }, body: {} }).success).toBe(false);
    expect(completeChallengeSchema.safeParse({
      params: { intentId: 'pi_123456' }, body: { challengeToken: 'short' },
    }).success).toBe(false);
  });

  test('get intent requires a well-formed id', () => {
    expect(getIntentSchema.safeParse({ params: { intentId: '' } }).success).toBe(false);
    expect(() => getIntentSchema.parse({ params: { intentId: 'pi_123456' } })).not.toThrow();
  });

  test('refunds accept partial amounts with reasons', () => {
    expect(() => refundSchema.parse({
      params: { intentId: 'pi_123456' }, body: { amount: 500, reason: 'Defective item' },
    })).not.toThrow();
    expect(refundSchema.safeParse({
      params: { intentId: 'pi_123456' }, body: { amount: 0, reason: 'x' },
    }).success).toBe(false);
  });
});

describe('paymentValidators method schemas', () => {
  test('method enrollment requires a provider reference', () => {
    expect(() => paymentMethodSchema.parse({
      body: { providerMethodId: 'pm_abc', provider: 'stripe', type: 'card' },
    })).not.toThrow();
    expect(paymentMethodSchema.safeParse({ body: { provider: 'stripe', type: 'card' } }).success).toBe(false);
  });

  test('setup intents scope providers and types', () => {
    expect(() => paymentMethodSetupIntentSchema.parse({ body: { provider: 'stripe', type: 'card' } })).not.toThrow();
    expect(paymentMethodSetupIntentSchema.safeParse({ body: { provider: 'razorpay', type: 'upi' } }).success).toBe(false);
  });

  test('method ids require minimum lengths', () => {
    expect(methodIdParamSchema.safeParse({ params: { methodId: 'x' } }).success).toBe(false);
    expect(() => methodIdParamSchema.parse({ params: { methodId: 'pm_123456' } })).not.toThrow();
  });
});

describe('Payment Validators (provider rails)', () => {
  test('createIntentSchema accepts NETBANKING with explicit bank context', async () => {
    const parsed = await createIntentSchema.parseAsync({
      body: {
        quotePayload: { orderItems: [{ product: 10, quantity: 1 }] },
        paymentMethod: 'NETBANKING',
        paymentContext: {
          market: { countryCode: 'in', currency: 'inr' },
          netbanking: { bankCode: 'hdfc', bankName: 'HDFC Bank', source: 'catalog' },
        },
      },
    });
    expect(parsed.body.paymentMethod).toBe('NETBANKING');
    expect(parsed.body.paymentContext.market.countryCode).toBe('IN');
    expect(parsed.body.paymentContext.netbanking.bankCode).toBe('HDFC');
  });

  test('createIntentSchema requires bank context for NETBANKING', async () => {
    await expect(createIntentSchema.parseAsync({
      body: { quotePayload: { orderItems: [{ product: 10, quantity: 1 }] }, paymentMethod: 'NETBANKING' },
    })).rejects.toBeTruthy();
  });

  test('paymentMethodSchema blocks unexpected metadata keys and over-sized values', async () => {
    await expect(paymentMethodSchema.parseAsync({
      body: { providerMethodId: 'user@upi', metadata: { isAdmin: true } },
    })).rejects.toBeTruthy();
    await expect(paymentMethodSchema.parseAsync({
      body: { providerMethodId: 'user@upi', metadata: { reference: 'x'.repeat(81) } },
    })).rejects.toBeTruthy();
  });

  test('paymentMethodSchema accepts allowlisted metadata payload', async () => {
    const parsed = await paymentMethodSchema.parseAsync({
      body: {
        providerMethodId: 'user@upi', paymentIntentId: 'pi_123456',
        metadata: { enrollmentSource: 'checkout', nickname: 'My UPI', reference: 'intent-link-1' },
      },
    });
    expect(parsed.body.metadata.enrollmentSource).toBe('checkout');
  });

  test('createIntentSchema accepts ISO market context and blocks malformed codes', async () => {
    const parsed = await createIntentSchema.parseAsync({
      body: {
        quotePayload: { orderItems: [{ product: 10, quantity: 1 }] },
        quoteSnapshot: { totalPrice: 499, cartVersion: 0 },
        paymentMethod: 'CARD',
        paymentContext: { market: { countryCode: 'us', currency: 'usd', language: 'es' } },
      },
    });
    expect(parsed.body.paymentContext.market).toEqual({ countryCode: 'US', currency: 'USD', language: 'es' });
    await expect(createIntentSchema.parseAsync({
      body: {
        quotePayload: { orderItems: [{ product: 10, quantity: 1 }] },
        paymentMethod: 'CARD',
        paymentContext: { market: { countryCode: 'USA', currency: 'usd' } },
      },
    })).rejects.toBeTruthy();
  });
});
