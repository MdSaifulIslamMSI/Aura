const crypto = require('crypto');
const { PaymentDomainError, PaymentProviderError } = require('./domainErrors');

const OUTBOX_EVENT_TYPES = Object.freeze([
    'payment.intent.created',
    'payment.intent.processing',
    'payment.intent.succeeded',
    'payment.intent.failed',
    'payment.refund.requested',
    'payment.refund.succeeded',
    'billing.invoice.created',
    'billing.invoice.paid',
    'ledger.transaction.created',
    'webhook.received',
    'webhook.processed',
]);

const topicForEvent = (eventType, topics = {}) => {
    if (eventType.startsWith('billing.')) return topics.billing || 'billing.events';
    if (eventType.startsWith('ledger.')) return topics.ledger || 'ledger.events';
    return topics.payments || 'payments.events';
};

const createOutboxEvent = ({
    eventType,
    aggregateType,
    aggregateId,
    payload = {},
    idempotencyKey,
    createdAt = new Date(),
}) => {
    if (!OUTBOX_EVENT_TYPES.includes(eventType)) {
        throw PaymentDomainError.invalidInput('Unsupported outbox event type.', { eventType });
    }
    const seed = idempotencyKey || `${eventType}:${aggregateType}:${aggregateId}:${createdAt.toISOString()}`;
    const eventId = `outbox_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 20)}`;
    return Object.freeze({
        eventId,
        eventType,
        aggregateType,
        aggregateId,
        payload: Object.freeze({ ...payload }),
        status: 'pending',
        attemptCount: 0,
        nextRunAt: createdAt.toISOString(),
        createdAt: createdAt.toISOString(),
    });
};

const markOutboxAttempt = (event, { success, error, now = new Date(), maxAttempts = 5 } = {}) => {
    const attemptCount = (event.attemptCount || 0) + 1;
    if (success) {
        return Object.freeze({
            ...event,
            status: 'sent',
            attemptCount,
            sentAt: now.toISOString(),
        });
    }

    const deadLettered = attemptCount >= maxAttempts;
    const delayMs = Math.min(60000, 1000 * (2 ** (attemptCount - 1)));
    return Object.freeze({
        ...event,
        status: deadLettered ? 'dead_lettered' : 'pending',
        attemptCount,
        lastError: String(error?.message || error || 'unknown error').slice(0, 500),
        nextRunAt: new Date(now.getTime() + delayMs).toISOString(),
    });
};

class LocalEventBus {
    constructor() {
        this.published = [];
        this.handlers = new Map();
    }

    subscribe(eventType, handler) {
        const handlers = this.handlers.get(eventType) || [];
        handlers.push(handler);
        this.handlers.set(eventType, handlers);
        return () => {
            this.handlers.set(eventType, (this.handlers.get(eventType) || []).filter((item) => item !== handler));
        };
    }

    async publish(event) {
        if (!OUTBOX_EVENT_TYPES.includes(event.eventType)) {
            throw PaymentDomainError.invalidInput('Unsupported event type.', { eventType: event.eventType });
        }
        this.published.push(event);
        const handlers = this.handlers.get(event.eventType) || [];
        for (const handler of handlers) {
            await handler(event);
        }
        return Object.freeze({ delivered: true, eventId: event.eventId });
    }
}

class KafkaEventBusAdapter {
    constructor({ producer, topics = {} } = {}) {
        this.producer = producer;
        this.topics = topics;
    }

    async publish(event) {
        if (!this.producer || typeof this.producer.send !== 'function') {
            throw new PaymentProviderError('event_bus.kafka_not_configured', 'Kafka producer is not configured.');
        }
        const topic = topicForEvent(event.eventType, this.topics);
        await this.producer.send({
            topic,
            messages: [
                {
                    key: event.aggregateId,
                    value: JSON.stringify(event),
                },
            ],
        });
        return Object.freeze({ delivered: true, topic, eventId: event.eventId });
    }
}

module.exports = {
    OUTBOX_EVENT_TYPES,
    topicForEvent,
    createOutboxEvent,
    markOutboxAttempt,
    LocalEventBus,
    KafkaEventBusAdapter,
};
