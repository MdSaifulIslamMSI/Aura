const { writeSecurityEvent } = require('./securityEventLogger');

const containmentState = new Map();
const DEFAULT_CONTAINMENT_TTL_MS = 15 * 60 * 1000;

const nowMs = () => Date.now();

const keyForContext = (context = {}) => (
    context.userId
    || context.ipHash
    || context.deviceFingerprintHash
    || context.userAgentHash
    || 'anonymous'
);

const normalizeActions = (actions = []) => (
    Array.isArray(actions) ? actions.filter(Boolean) : []
);

const applyContainment = ({ context = {}, decision = {}, req = null, ttlMs = DEFAULT_CONTAINMENT_TTL_MS } = {}) => {
    const key = keyForContext(context);
    const actions = normalizeActions(decision.containmentActions || decision.containmentPolicy);
    const expiresAt = nowMs() + ttlMs;
    const previous = containmentState.get(key) || { actions: [], incidents: 0 };
    const next = {
        key,
        actions: [...new Set([...previous.actions, ...actions])],
        incidents: Number(previous.incidents || 0) + 1,
        expiresAt,
        action: context.action || decision.action || '',
        reason: decision.reason || 'containment_triggered',
    };
    containmentState.set(key, next);

    writeSecurityEvent({
        event: 'containment.triggered',
        req,
        userId: context.userId,
        tenantId: context.tenantId,
        action: context.action || decision.action,
        route: context.route,
        method: context.method,
        ipHash: context.ipHash,
        userAgentHash: context.userAgentHash,
        riskScore: decision.riskScore,
        decision: 'CONTAIN',
        reasonCode: next.reason,
        metadata: {
            containmentActions: next.actions,
            expiresAt: new Date(expiresAt).toISOString(),
        },
    }, { level: 'warn' });

    if (req) {
        req.securityContainment = next;
        if (actions.includes('revoke_session') && req.authSession) {
            req.authSession.revoked = true;
        }
    }

    return next;
};

const getContainmentState = (context = {}) => {
    const key = keyForContext(context);
    const state = containmentState.get(key);
    if (!state) return null;
    if (state.expiresAt <= nowMs()) {
        containmentState.delete(key);
        return null;
    }
    return state;
};

const isActionContained = (context = {}, containmentAction = '') => {
    const state = getContainmentState(context);
    if (!state) return false;
    return state.actions.includes(containmentAction);
};

module.exports = {
    DEFAULT_CONTAINMENT_TTL_MS,
    applyContainment,
    getContainmentState,
    isActionContained,
    __resetContainmentState: () => containmentState.clear(),
};
