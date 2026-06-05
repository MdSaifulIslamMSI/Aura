const denyTrustDecision = (decision = {}) => (req, res, next) => {
    req.trustDecision = decision;
    const decisionId = decision.evidence?.decisionId || '';

    if (decision.decision === 'CHALLENGE') {
        return res.status(428).json({
            error: 'STEP_UP_REQUIRED',
            requiredStepUp: decision.requiredStepUp,
            reason: decision.reason,
            decisionId,
        });
    }

    if (decision.decision === 'THROTTLE') {
        return res.status(429).json({
            error: 'TRUST_THROTTLED',
            reason: decision.reason,
            decisionId,
        });
    }

    if (['BLOCK', 'QUARANTINE'].includes(decision.decision)) {
        return res.status(403).json({
            error: 'ACCESS_DENIED',
            reason: decision.reason,
            decisionId,
        });
    }

    return next();
};

module.exports = {
    denyTrustDecision,
};
