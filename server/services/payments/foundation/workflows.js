const { PaymentDomainError } = require('./domainErrors');
const { retryWithBackoff, withTimeout, validatePaymentProvider } = require('./providerContract');
const { createOutboxEvent } = require('./eventBus');

class LocalDurableWorkflowRunner {
    constructor() {
        this.executions = new Map();
    }

    async start(workflowId, workflow) {
        if (!workflowId) {
            throw PaymentDomainError.invalidInput('workflowId is required.');
        }
        if (this.executions.has(workflowId)) {
            return this.executions.get(workflowId);
        }
        const result = await workflow();
        const execution = Object.freeze({
            workflowId,
            status: 'completed',
            result,
            completedAt: new Date().toISOString(),
        });
        this.executions.set(workflowId, execution);
        return execution;
    }
}

const runActivity = (activity, options = {}) => retryWithBackoff(
    () => withTimeout(activity, options.timeoutMs || 5000, options.name || 'payment activity'),
    options.retryOptions || { retries: 2, initialDelayMs: 100, maxDelayMs: 1000 }
);

const createPaymentWorkflow = ({ provider, eventBus }) => {
    validatePaymentProvider(provider);
    const runner = new LocalDurableWorkflowRunner();
    return async ({ workflowId, paymentInput, confirmInput }) => {
        return runner.start(workflowId, async () => {
            const created = await runActivity(() => provider.createPaymentIntent(paymentInput), {
                name: 'payment.create_intent',
            });
            if (eventBus) {
                await eventBus.publish(createOutboxEvent({
                    eventType: 'payment.intent.created',
                    aggregateType: 'payment_intent',
                    aggregateId: created.providerReference,
                    payload: { provider: created.provider, status: created.status },
                    idempotencyKey: `${workflowId}:created`,
                }));
            }

            if (!confirmInput) {
                return created;
            }

            const confirmed = await runActivity(() => provider.confirmPayment({
                ...confirmInput,
                providerReference: created.providerReference,
            }), { name: 'payment.confirm' });

            if (eventBus) {
                await eventBus.publish(createOutboxEvent({
                    eventType: confirmed.status === 'succeeded' ? 'payment.intent.succeeded' : 'payment.intent.processing',
                    aggregateType: 'payment_intent',
                    aggregateId: confirmed.providerReference,
                    payload: { provider: confirmed.provider, status: confirmed.status },
                    idempotencyKey: `${workflowId}:confirmed`,
                }));
            }
            return confirmed;
        });
    };
};

const createRefundWorkflow = ({ provider, eventBus }) => {
    validatePaymentProvider(provider);
    const runner = new LocalDurableWorkflowRunner();
    return async ({ workflowId, refundInput }) => {
        return runner.start(workflowId, async () => {
            if (eventBus) {
                await eventBus.publish(createOutboxEvent({
                    eventType: 'payment.refund.requested',
                    aggregateType: 'refund',
                    aggregateId: workflowId,
                    payload: { amountMinor: refundInput.amountMinor, currency: refundInput.currency },
                    idempotencyKey: `${workflowId}:requested`,
                }));
            }
            const refund = await runActivity(() => provider.refundPayment(refundInput), {
                name: 'payment.refund',
            });
            if (eventBus) {
                await eventBus.publish(createOutboxEvent({
                    eventType: 'payment.refund.succeeded',
                    aggregateType: 'refund',
                    aggregateId: refund.providerReference,
                    payload: { provider: refund.provider, status: refund.status },
                    idempotencyKey: `${workflowId}:succeeded`,
                }));
            }
            return refund;
        });
    };
};

module.exports = {
    LocalDurableWorkflowRunner,
    runActivity,
    createPaymentWorkflow,
    createRefundWorkflow,
};
