const { createDistributedRateLimit } = require('./distributedRateLimit');
const {
    buildFeatureError,
    getFlag,
    isEnabled,
} = require('../services/emergencyControlService');
const logger = require('../utils/logger');
const { getTrustedRequestIp } = require('../utils/requestIdentity');
const {
    getEmergencyPoliciesForRequest,
    isMaintenanceAllowedPath,
    isReadOnlyExemptPath,
    isStateChangingRequest,
    normalizeRequestPath,
} = require('../config/emergencyRoutePolicies');
const { recordEmergencyRequestBlocked } = require('../services/emergencyControlMetrics');

const strictEmergencyLimiter = createDistributedRateLimit({
    allowInMemoryFallback: true,
    securityCritical: true,
    name: 'emergency_strict_global',
    windowMs: Number(process.env.EMERGENCY_STRICT_RATE_LIMIT_WINDOW_MS || 60 * 1000),
    max: Number(process.env.EMERGENCY_STRICT_RATE_LIMIT_MAX || 30),
    message: {
        success: false,
        code: 'STRICT_RATE_LIMIT_MODE',
        message: 'Too many requests while emergency protection is active. Please slow down.',
    },
    keyGenerator: (req) => getTrustedRequestIp(req),
    skip: (req) => isMaintenanceAllowedPath(req),
});

const logAndRespond = ({
    req,
    res,
    flagKey,
    code,
    feature,
    message,
    statusCode = 503,
}) => {
    const route = normalizeRequestPath(req);
    const requestId = req.requestId || '';
    recordEmergencyRequestBlocked({ flagKey, route });
    logger.warn('emergency.request_blocked', {
        flagKey,
        code,
        feature,
        method: req.method,
        route,
        requestId,
        ip: req.ip,
    });
    return res.status(statusCode).json({
        success: false,
        code,
        ...(feature ? { feature } : {}),
        message,
        requestId,
    });
};

const globalEmergencyMiddleware = async (req, res, next) => {
    try {
        const enabled = await isEnabled('GLOBAL_MAINTENANCE', { failClosed: false });
        if (!enabled || isMaintenanceAllowedPath(req)) return next();
        const flag = await getFlag('GLOBAL_MAINTENANCE', { includeInactive: false }).catch(() => null);
        return logAndRespond({
            req,
            res,
            flagKey: 'GLOBAL_MAINTENANCE',
            code: 'MAINTENANCE_MODE',
            feature: 'maintenance',
            message: flag?.userMessage || 'We are temporarily performing emergency maintenance. Please try again later.',
            statusCode: 503,
        });
    } catch (error) {
        logger.warn('emergency.global_eval_failed_open', {
            error: error?.message || 'unknown',
            requestId: req.requestId || '',
        });
        return next();
    }
};

const readOnlyMiddleware = async (req, res, next) => {
    if (!isStateChangingRequest(req) || isReadOnlyExemptPath(req)) return next();
    try {
        const enabled = await isEnabled('READ_ONLY_MODE', { failClosed: true });
        if (!enabled) return next();
        const flag = await getFlag('READ_ONLY_MODE', { includeInactive: false }).catch(() => null);
        return logAndRespond({
            req,
            res,
            flagKey: 'READ_ONLY_MODE',
            code: 'READ_ONLY_MODE',
            feature: 'write',
            message: flag?.userMessage || 'The system is temporarily in read-only mode.',
            statusCode: 423,
        });
    } catch (error) {
        const emergencyError = buildFeatureError('READ_ONLY_MODE', {
            code: 'READ_ONLY_MODE',
            feature: 'write',
            statusCode: 423,
        });
        return logAndRespond({
            req,
            res,
            flagKey: 'READ_ONLY_MODE',
            code: emergencyError.code,
            feature: emergencyError.feature,
            message: emergencyError.message,
            statusCode: emergencyError.statusCode,
        });
    }
};

const strictRateLimitMiddleware = async (req, res, next) => {
    try {
        if (!(await isEnabled('STRICT_RATE_LIMIT_MODE', { failClosed: false }))) return next();
        return strictEmergencyLimiter(req, res, next);
    } catch (error) {
        logger.warn('emergency.strict_rate_limit_eval_failed_open', {
            error: error?.message || 'unknown',
            requestId: req.requestId || '',
        });
        return next();
    }
};

const emergencyRoutePolicyMiddleware = async (req, res, next) => {
    const policies = getEmergencyPoliciesForRequest(req);
    if (policies.length === 0) return next();

    for (const policy of policies) {
        try {
            const enabled = await isEnabled(policy.flagKey, { failClosed: policy.failClosed });
            if (!enabled) continue;
            return logAndRespond({
                req,
                res,
                flagKey: policy.flagKey,
                code: 'FEATURE_TEMPORARILY_DISABLED',
                feature: policy.feature,
                message: policy.message,
                statusCode: 503,
            });
        } catch (error) {
            if (!policy.failClosed) continue;
            return logAndRespond({
                req,
                res,
                flagKey: policy.flagKey,
                code: 'FEATURE_TEMPORARILY_DISABLED',
                feature: policy.feature,
                message: policy.message,
                statusCode: 503,
            });
        }
    }

    return next();
};

module.exports = {
    emergencyRoutePolicyMiddleware,
    globalEmergencyMiddleware,
    readOnlyMiddleware,
    strictRateLimitMiddleware,
};
