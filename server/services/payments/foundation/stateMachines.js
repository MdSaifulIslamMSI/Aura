const { PaymentDomainError } = require('./domainErrors');

const PAYMENT_INTENT_STATES = Object.freeze([
    'created',
    'requires_payment_method',
    'requires_confirmation',
    'processing',
    'succeeded',
    'failed',
    'canceled',
    'refunded',
    'partially_refunded',
    'disputed',
]);

const REFUND_STATES = Object.freeze([
    'requested',
    'approved',
    'processing',
    'succeeded',
    'failed',
    'canceled',
]);

const INVOICE_STATES = Object.freeze([
    'draft',
    'open',
    'paid',
    'void',
    'uncollectible',
]);

const SUBSCRIPTION_STATES = Object.freeze([
    'trialing',
    'active',
    'past_due',
    'paused',
    'canceled',
    'expired',
]);

const TRANSITIONS = Object.freeze({
    payment_intent: Object.freeze({
        created: ['requires_payment_method', 'requires_confirmation', 'processing', 'failed', 'canceled'],
        requires_payment_method: ['requires_confirmation', 'failed', 'canceled'],
        requires_confirmation: ['processing', 'failed', 'canceled'],
        processing: ['succeeded', 'failed', 'canceled'],
        succeeded: ['partially_refunded', 'refunded', 'disputed'],
        partially_refunded: ['refunded', 'disputed'],
        failed: [],
        canceled: [],
        refunded: ['disputed'],
        disputed: ['partially_refunded', 'refunded'],
    }),
    refund: Object.freeze({
        requested: ['approved', 'canceled', 'failed'],
        approved: ['processing', 'canceled', 'failed'],
        processing: ['succeeded', 'failed'],
        succeeded: [],
        failed: [],
        canceled: [],
    }),
    invoice: Object.freeze({
        draft: ['open', 'void'],
        open: ['paid', 'void', 'uncollectible'],
        paid: [],
        void: [],
        uncollectible: ['paid', 'void'],
    }),
    subscription: Object.freeze({
        trialing: ['active', 'past_due', 'canceled', 'expired'],
        active: ['past_due', 'paused', 'canceled', 'expired'],
        past_due: ['active', 'paused', 'canceled', 'expired'],
        paused: ['active', 'canceled', 'expired'],
        canceled: [],
        expired: [],
    }),
});

const FORBIDDEN_PAYMENT_FIELD_KEYS = new Set([
    'pan',
    'primaryaccountnumber',
    'cardnumber',
    'fullcardnumber',
    'cardpan',
    'cvv',
    'cvc',
    'cardverificationvalue',
    'magneticstripe',
    'stripedata',
    'track1',
    'track2',
    'rawcard',
]);

const normalizeFieldKey = (key) => String(key || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const isObjectLike = (value) => value !== null && typeof value === 'object';

const assertNoRawPaymentData = (value, path = '$') => {
    if (!isObjectLike(value)) {
        return;
    }

    if (Array.isArray(value)) {
        value.forEach((item, index) => assertNoRawPaymentData(item, `${path}[${index}]`));
        return;
    }

    Object.entries(value).forEach(([key, nestedValue]) => {
        const normalizedKey = normalizeFieldKey(key);
        if (FORBIDDEN_PAYMENT_FIELD_KEYS.has(normalizedKey)) {
            throw PaymentDomainError.unsafePaymentData(`${path}.${key}`);
        }
        assertNoRawPaymentData(nestedValue, `${path}.${key}`);
    });
};

const getTransitionTargets = (entityType, from) => {
    const entityTransitions = TRANSITIONS[entityType];
    if (!entityTransitions) {
        throw PaymentDomainError.invalidInput(`Unknown payment entity type: ${entityType}`, { entityType });
    }
    return entityTransitions[from];
};

const canTransition = (entityType, from, to) => {
    if (from === to) {
        return true;
    }
    const targets = getTransitionTargets(entityType, from);
    return Array.isArray(targets) && targets.includes(to);
};

const createAuditEvent = ({
    entityType,
    entityId,
    from,
    to,
    actor = 'system',
    reason = 'state_transition',
    metadata = {},
    at = new Date(),
}) => ({
    eventType: `${entityType}.state_changed`,
    entityType,
    entityId,
    from,
    to,
    actor,
    reason,
    metadata: Object.freeze({ ...metadata }),
    occurredAt: at.toISOString(),
});

const transitionEntity = ({
    entityType,
    entityId,
    from,
    to,
    actor,
    reason,
    metadata,
    at,
}) => {
    if (!canTransition(entityType, from, to)) {
        throw PaymentDomainError.invalidTransition(entityType, from, to);
    }

    return Object.freeze({
        entityType,
        entityId,
        from,
        to,
        changed: from !== to,
        auditEvent: createAuditEvent({ entityType, entityId, from, to, actor, reason, metadata, at }),
    });
};

module.exports = {
    PAYMENT_INTENT_STATES,
    REFUND_STATES,
    INVOICE_STATES,
    SUBSCRIPTION_STATES,
    TRANSITIONS,
    assertNoRawPaymentData,
    canTransition,
    transitionEntity,
};
