const { evaluateSecurityDecision } = require('../security/securityDecisionEngine');
const { SECURITY_DECISIONS } = require('../security/securityDecisionTypes');
const { buildSecurityContext } = require('../security/securityContextBuilder');
const { applyContainment } = require('../security/containmentService');

const writeNoStore = (res) => {
    if (typeof res.set === 'function') {
        res.set('Cache-Control', 'no-store');
    } else if (typeof res.setHeader === 'function') {
        res.setHeader('Cache-Control', 'no-store');
    }
};

const sendSecurityDecision = (req, res, decision) => {
    writeNoStore(res);
    switch (decision.decision) {
        case SECURITY_DECISIONS.CHALLENGE:
            return res.status(403).json({
                success: false,
                code: 'STEP_UP_REQUIRED',
                step_up_required: true,
                message: 'Additional verification is required.',
                requestId: req.requestId || '',
            });
        case SECURITY_DECISIONS.THROTTLE:
            return res.status(429).json({
                success: false,
                code: 'REQUEST_THROTTLED',
                message: 'Too many requests. Please try again later.',
                requestId: req.requestId || '',
            });
        case SECURITY_DECISIONS.CONTAIN:
            applyContainment({ req, context: req.securityContext || {}, decision });
            return res.status(403).json({
                success: false,
                code: 'ACTION_NOT_ALLOWED',
                message: 'This action is not allowed right now.',
                requestId: req.requestId || '',
            });
        case SECURITY_DECISIONS.DENY:
        default:
            return res.status(403).json({
                success: false,
                code: 'ACTION_NOT_ALLOWED',
                message: 'This action is not allowed.',
                requestId: req.requestId || '',
            });
    }
};

const requireSecurityDecision = (action, options = {}) => (req, res, next) => {
    try {
        const context = buildSecurityContext(req, {
            ...options.context,
            action,
        });
        req.securityContext = context;
        req.securityAction = action;
        const decision = evaluateSecurityDecision(context, options);
        req.securityDecision = decision;

        if (
            decision.decision === SECURITY_DECISIONS.ALLOW
            || decision.decision === SECURITY_DECISIONS.ALLOW_WITH_AUDIT
        ) {
            return next();
        }

        return sendSecurityDecision(req, res, decision);
    } catch (error) {
        return next(error);
    }
};

module.exports = {
    requireSecurityDecision,
    sendSecurityDecision,
};
