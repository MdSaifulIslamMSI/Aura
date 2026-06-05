const normalizeState = (value = '') => String(value || '').trim().toLowerCase();

const resolveResourceState = (resource = {}) => normalizeState(
    resource.state
    || resource.status
    || resource.orderStatus
    || resource.paymentState
    || resource.scanState
);

const normalizeStateList = (values = []) => (
    Array.isArray(values)
        ? values.map(normalizeState).filter(Boolean)
        : []
);

const evaluateResourceState = ({ resource = {}, policy = {} } = {}) => {
    if (resource?.duplicate && policy.requireIdempotency) {
        return {
            ok: false,
            reason: 'PAYMENT_WEBHOOK_REPLAY',
            state: 'duplicate',
        };
    }

    const state = resolveResourceState(resource);
    const allowedStates = normalizeStateList(policy.allowedStates);
    const denyStates = normalizeStateList(policy.denyStates);

    if (state && denyStates.includes(state)) {
        return {
            ok: false,
            reason: 'RESOURCE_STATE_DENIED',
            state,
        };
    }

    if (state && allowedStates.length > 0 && !allowedStates.includes(state)) {
        return {
            ok: false,
            reason: 'RESOURCE_STATE_INVALID',
            state,
            allowedStates,
        };
    }

    return {
        ok: true,
        reason: 'RESOURCE_STATE_OK',
        state,
    };
};

module.exports = {
    evaluateResourceState,
    resolveResourceState,
};
