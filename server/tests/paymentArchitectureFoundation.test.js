const {
    assertNoRawPaymentData,
    canTransition,
    transitionEntity,
} = require('../services/payments/foundation/stateMachines');
const { PaymentDomainError } = require('../services/payments/foundation/domainErrors');
const { MockPaymentProvider } = require('../services/payments/foundation/mockPaymentProvider');
const {
    buildPaymentSuccessTransaction,
    buildRefundTransaction,
    createLedgerTransaction,
} = require('../services/payments/foundation/ledgerService');
const { MockBillingProvider } = require('../services/payments/foundation/billingProvider');
const { createOutboxEvent, markOutboxAttempt, LocalEventBus } = require('../services/payments/foundation/eventBus');
const { createPaymentWorkflow } = require('../services/payments/foundation/workflows');
const { evaluatePaymentPolicy } = require('../services/payments/foundation/paymentPolicy');
const { validatePaymentEnvironment } = require('../services/payments/foundation/env');
const { redactSensitivePaymentLog } = require('../services/payments/foundation/observability');

describe('payment architecture foundation', () => {
    test('validates state transitions and writes audit events', () => {
        expect(canTransition('payment_intent', 'created', 'requires_confirmation')).toBe(true);
        expect(canTransition('payment_intent', 'succeeded', 'created')).toBe(false);

        const transition = transitionEntity({
            entityType: 'payment_intent',
            entityId: 'pi_1',
            from: 'created',
            to: 'requires_confirmation',
            actor: 'user:user_1',
            reason: 'checkout_started',
        });

        expect(transition.changed).toBe(true);
        expect(transition.auditEvent).toMatchObject({
            eventType: 'payment_intent.state_changed',
            entityId: 'pi_1',
            from: 'created',
            to: 'requires_confirmation',
            actor: 'user:user_1',
        });

        expect(() => transitionEntity({
            entityType: 'payment_intent',
            entityId: 'pi_1',
            from: 'succeeded',
            to: 'processing',
        })).toThrow(PaymentDomainError);
    });

    test('rejects raw card data in architecture payloads', () => {
        expect(() => assertNoRawPaymentData({
            paymentMethodReference: 'pm_token_123',
            cardLast4: '4242',
        })).not.toThrow();

        expect(() => assertNoRawPaymentData({
            nested: {
                cardNumber: '4242424242424242',
            },
        })).toThrow('Raw card data is not allowed');
    });

    test('mock provider is idempotent and verifies duplicate webhooks', async () => {
        const provider = new MockPaymentProvider({ webhookSecret: 'test-webhook-secret' });
        const input = {
            amountMinor: 129900,
            currency: 'INR',
            customerId: 'user_1',
            orderId: 'order_1',
            idempotencyKey: 'idem-create-1',
        };

        const first = await provider.createPaymentIntent(input);
        const replay = await provider.createPaymentIntent(input);
        expect(replay).toBe(first);

        const confirmed = await provider.confirmPayment({
            providerReference: first.providerReference,
            idempotencyKey: 'idem-confirm-1',
        });
        expect(confirmed.status).toBe('succeeded');

        const event = provider.signWebhook({ id: 'evt_1', type: 'payment.succeeded', payment_id: first.providerReference });
        const parsed = provider.parseWebhook(event.rawBody, event.headers);
        const duplicate = provider.parseWebhook(event.rawBody, event.headers);
        expect(parsed.duplicate).toBe(false);
        expect(duplicate.duplicate).toBe(true);

        expect(() => provider.parseWebhook(event.rawBody, { 'x-mock-signature': 'bad' })).toThrow('Invalid mock webhook signature');
    });

    test('ledger requires balanced double-entry integer minor-unit transactions', () => {
        const success = buildPaymentSuccessTransaction({
            paymentIntentId: 'pi_1',
            userId: 'user_1',
            provider: 'mock',
            amountMinor: 10000,
            currency: 'INR',
            feeMinor: 300,
            taxMinor: 700,
        });
        expect(Object.isFrozen(success)).toBe(true);
        expect(success.entries.reduce((sum, entry) => sum + (entry.direction === 'debit' ? entry.amountMinor : -entry.amountMinor), 0)).toBe(0);

        const refund = buildRefundTransaction({
            refundId: 'rf_1',
            paymentIntentId: 'pi_1',
            userId: 'user_1',
            provider: 'mock',
            amountMinor: 2500,
            currency: 'INR',
        });
        expect(refund.sourceType).toBe('refund');

        expect(() => createLedgerTransaction({
            sourceType: 'test',
            sourceId: 'bad',
            entries: [
                { account: 'a', direction: 'debit', amountMinor: 100, currency: 'INR' },
                { account: 'b', direction: 'credit', amountMinor: 99, currency: 'INR' },
            ],
        })).toThrow('balance to zero');
    });

    test('billing mock records usage idempotently and links invoice payment', async () => {
        const billing = new MockBillingProvider();
        const customer = await billing.createCustomer({ externalCustomerId: 'user_1', email: 'buyer@example.test' });
        const subscription = await billing.createSubscription({ customerId: customer.customerId, planCode: 'pro' });
        const usage = await billing.recordUsage({
            customerId: customer.customerId,
            subscriptionId: subscription.subscriptionId,
            metricCode: 'tokens',
            quantity: 42,
            idempotencyKey: 'usage-1',
        });
        const replay = await billing.recordUsage({
            customerId: customer.customerId,
            subscriptionId: subscription.subscriptionId,
            metricCode: 'tokens',
            quantity: 42,
            idempotencyKey: 'usage-1',
        });
        expect(replay).toBe(usage);

        const invoice = await billing.createInvoice({
            customerId: customer.customerId,
            subscriptionId: subscription.subscriptionId,
            amountMinor: 9900,
            currency: 'INR',
        });
        const paid = await billing.markInvoicePaid({ invoiceId: invoice.invoiceId, paymentIntentId: 'pi_1' });
        expect(paid.status).toBe('paid');
        expect(paid.paymentIntentId).toBe('pi_1');
    });

    test('outbox and local event bus support retries and delivery', async () => {
        const eventBus = new LocalEventBus();
        const received = [];
        eventBus.subscribe('payment.intent.created', (event) => received.push(event));

        const event = createOutboxEvent({
            eventType: 'payment.intent.created',
            aggregateType: 'payment_intent',
            aggregateId: 'pi_1',
            payload: { status: 'created' },
            idempotencyKey: 'pi_1:created',
        });

        await eventBus.publish(event);
        expect(received).toHaveLength(1);

        const failedAttempt = markOutboxAttempt(event, { success: false, error: new Error('broker down') });
        expect(failedAttempt.status).toBe('pending');
        const sentAttempt = markOutboxAttempt(failedAttempt, { success: true });
        expect(sentAttempt.status).toBe('sent');
    });

    test('payment workflow emits idempotent local events', async () => {
        const provider = new MockPaymentProvider();
        const eventBus = new LocalEventBus();
        const workflow = createPaymentWorkflow({ provider, eventBus });

        const result = await workflow({
            workflowId: 'wf_payment_1',
            paymentInput: {
                amountMinor: 5000,
                currency: 'INR',
                customerId: 'user_1',
                orderId: 'order_1',
                idempotencyKey: 'idem-wf-create-1',
            },
            confirmInput: {
                idempotencyKey: 'idem-wf-confirm-1',
            },
        });

        expect(result.status).toBe('completed');
        expect(result.result.status).toBe('succeeded');
        const replay = await workflow({
            workflowId: 'wf_payment_1',
            paymentInput: {
                amountMinor: 5000,
                currency: 'INR',
                customerId: 'user_1',
                orderId: 'order_1',
                idempotencyKey: 'idem-wf-create-1',
            },
            confirmInput: {
                idempotencyKey: 'idem-wf-confirm-1',
            },
        });
        expect(replay).toBe(result);
        expect(eventBus.published.map((event) => event.eventType)).toEqual([
            'payment.intent.created',
            'payment.intent.succeeded',
        ]);
    });

    test('policy enforces ownership, refund permission, and webhook signature', () => {
        expect(evaluatePaymentPolicy('payment:create', {
            principal: { userId: 'user_1' },
            resource: { userId: 'user_1' },
        }).allowed).toBe(true);

        expect(evaluatePaymentPolicy('payment:create', {
            principal: { userId: 'user_2' },
            resource: { userId: 'user_1' },
        }).allowed).toBe(false);

        expect(evaluatePaymentPolicy('payment:refund', {
            principal: { roles: ['payment:refund'] },
            input: { amountMinor: 700000 },
        })).toMatchObject({ allowed: false, approvalRequired: true });

        expect(evaluatePaymentPolicy('payment:refund', {
            principal: { roles: ['payment:refund'] },
            input: { amountMinor: 700000, approvedBy: 'admin_1' },
        }).allowed).toBe(true);

        expect(evaluatePaymentPolicy('payment:webhook', { signatureVerified: false }).allowed).toBe(false);
        expect(evaluatePaymentPolicy('payment:webhook', { signatureVerified: true }).allowed).toBe(true);
    });

    test('environment validation fails closed for live mode and permits local mock mode', () => {
        const local = validatePaymentEnvironment({});
        expect(local.ok).toBe(true);
        expect(local.config.PAYMENT_PROVIDER).toBe('mock');

        const live = validatePaymentEnvironment({
            PAYMENT_MODE: 'live',
            PAYMENT_PROVIDER: 'hyperswitch',
            BILLING_PROVIDER: 'lago',
            EVENT_BUS: 'kafka',
            SECRETS_PROVIDER: 'openbao',
        });
        expect(live.ok).toBe(false);
        expect(live.errors).toEqual(expect.arrayContaining([
            'PAYMENT_WEBHOOK_SECRET is required.',
            'HYPERSWITCH_API_KEY is required.',
            'LAGO_API_KEY is required.',
            'KAFKA_BROKERS is required.',
            'OPENBAO_TOKEN is required.',
        ]));
    });

    test('observability helpers redact secrets and tokens', () => {
        const bearer = ['Bearer ', 'payment-observability-token'].join('');
        const webhookSecret = ['whsec_', 'paymentobservability'].join('');
        const apiKey = ['sk_test_', 'paymentobservability'].join('');
        const paymentClientSecret = ['pi_paymentobservable_', 'secret_123'].join('');
        const redacted = redactSensitivePaymentLog({
            provider: 'hyperswitch',
            HYPERSWITCH_API_KEY: 'should-not-leak',
            webhookSignature: 'signature-should-not-leak',
            signatureVerified: true,
            nested: {
                token: 'also-hidden',
                paymentIntentId: 'pi_1',
                message: `provider failed with ${bearer} ${webhookSecret} ${apiKey} ${paymentClientSecret}`,
            },
        });
        const serialized = JSON.stringify(redacted);
        expect(redacted.HYPERSWITCH_API_KEY).toBe('[redacted]');
        expect(redacted.webhookSignature).toBe('[redacted]');
        expect(redacted.signatureVerified).toBe(true);
        expect(redacted.nested.token).toBe('[redacted]');
        expect(redacted.nested.paymentIntentId).toBe('pi_1');
        expect(serialized).not.toContain(bearer);
        expect(serialized).not.toContain(webhookSecret);
        expect(serialized).not.toContain(apiKey);
        expect(serialized).not.toContain(paymentClientSecret);
    });
});
