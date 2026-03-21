const ACTION_RISK = {
    ANSWER: 'LOW',
    SEARCH: 'LOW',
    NAVIGATE: 'MEDIUM',
    ADD_TO_CART: 'HIGH',
    REMOVE_FROM_CART: 'HIGH',
    SUPPORT: 'MEDIUM',
    CHECKOUT: 'CRITICAL',
    UNKNOWN: 'MEDIUM',
};

const HIGH_RISK_ACTIONS = new Set(['ADD_TO_CART', 'REMOVE_FROM_CART', 'CHECKOUT']);

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const resolveActionType = (interpretation = {}) => {
    const intent = safeString(interpretation?.intent || '');
    const page = safeString(interpretation?.meta?.page || '');
    const operation = safeString(interpretation?.meta?.operation || '');

    if (intent === 'general_knowledge') return 'ANSWER';
    if (intent === 'product_search') return 'SEARCH';
    if (intent === 'support') return 'SUPPORT';
    if (intent === 'cart_action') {
        return operation === 'remove' ? 'REMOVE_FROM_CART' : 'ADD_TO_CART';
    }
    if (intent === 'navigation') {
        return page === 'checkout' ? 'CHECKOUT' : 'NAVIGATE';
    }

    return 'UNKNOWN';
};

const hasRequiredEntities = (interpretation = {}, actionType = 'UNKNOWN') => {
    const productId = safeString(interpretation?.entities?.productId || '');
    const category = safeString(interpretation?.entities?.category || '');
    const page = safeString(interpretation?.meta?.page || '');

    if (actionType === 'ADD_TO_CART' || actionType === 'REMOVE_FROM_CART') {
        return Boolean(productId);
    }

    if (actionType === 'NAVIGATE' && page === 'product') {
        return Boolean(productId);
    }

    if (actionType === 'NAVIGATE' && page === 'category') {
        return Boolean(category);
    }

    return true;
};

const evaluateExecutionPolicy = ({
    intentResolution = {},
    clarificationAttempts = 0,
} = {}) => {
    const actionType = resolveActionType(intentResolution);
    const risk = ACTION_RISK[actionType] || ACTION_RISK.UNKNOWN;
    const confidence = Number(intentResolution?.confidence || 0);

    if (intentResolution?.intent === 'general_knowledge') {
        return {
            actionType,
            risk,
            confidence,
            decision: 'RESPOND',
            reason: 'knowledge_response',
        };
    }

    if (!hasRequiredEntities(intentResolution, actionType)) {
        return {
            actionType,
            risk,
            confidence,
            decision: clarificationAttempts >= 2 ? 'FORCE_STRUCTURED_UI' : 'CLARIFY',
            reason: 'missing_required_entities',
        };
    }

    if (clarificationAttempts >= 2 && confidence < 0.4) {
        return {
            actionType,
            risk,
            confidence,
            decision: 'FORCE_STRUCTURED_UI',
            reason: 'clarification_attempts_exhausted',
        };
    }

    if (actionType === 'CHECKOUT') {
        return {
            actionType,
            risk,
            confidence,
            decision: 'CONFIRM',
            reason: 'critical_checkout_requires_confirmation',
        };
    }

    if (confidence >= 0.7) {
        return {
            actionType,
            risk,
            confidence,
            decision: HIGH_RISK_ACTIONS.has(actionType) ? 'CONFIRM' : 'EXECUTE',
            reason: HIGH_RISK_ACTIONS.has(actionType)
                ? 'high_confidence_risky_action_requires_confirmation'
                : 'high_confidence_low_risk_execute',
        };
    }

    if (confidence >= 0.55) {
        return {
            actionType,
            risk,
            confidence,
            decision: 'CONFIRM',
            reason: 'mid_confidence_requires_confirmation',
        };
    }

    if (confidence >= 0.4) {
        return {
            actionType,
            risk,
            confidence,
            decision: 'CLARIFY',
            reason: 'low_confidence_requires_clarification',
        };
    }

    return {
        actionType,
        risk,
        confidence,
        decision: 'CLARIFY_STRONG',
        reason: 'very_low_confidence_requires_structured_clarification',
    };
};

module.exports = {
    ACTION_RISK,
    evaluateExecutionPolicy,
    resolveActionType,
};
