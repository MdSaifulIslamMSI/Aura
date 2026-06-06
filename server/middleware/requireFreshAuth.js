const { getSensitiveActionPolicy } = require('../security/sensitiveActionRegistry');
const { isFreshAuthSatisfied } = require('../security/freshAuthService');
const { buildSecurityContext } = require('../security/securityContextBuilder');
const { writeSecurityEvent } = require('../security/securityEventLogger');

const requireFreshAuth = (action, options = {}) => (req, res, next) => {
    try {
        const context = req.securityContext || buildSecurityContext(req, { action });
        const policy = getSensitiveActionPolicy(action) || {
            action,
            requiresFreshAuth: true,
            requiresMfa: Boolean(options.requiresMfa),
            requiresPasskeyForAdmin: Boolean(options.requiresPasskeyForAdmin),
        };
        const result = isFreshAuthSatisfied(context, {
            ...policy,
            ...options,
        });

        if (result.ok) return next();

        writeSecurityEvent({
            event: 'auth.stepup.required',
            req,
            userId: context.userId,
            tenantId: context.tenantId,
            action,
            route: context.route,
            method: context.method,
            ipHash: context.ipHash,
            userAgentHash: context.userAgentHash,
            riskScore: 60,
            decision: 'CHALLENGE',
            reasonCode: result.reason,
            metadata: { windowSeconds: result.windowSeconds },
        }, { level: 'warn' });

        res.set('Cache-Control', 'no-store');
        return res.status(403).json({
            success: false,
            code: 'STEP_UP_REQUIRED',
            step_up_required: true,
            message: 'Additional verification is required.',
            requestId: req.requestId || '',
        });
    } catch (error) {
        return next(error);
    }
};

module.exports = {
    requireFreshAuth,
};
