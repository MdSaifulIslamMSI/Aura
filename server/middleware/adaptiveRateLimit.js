const { writeSecurityEvent } = require('../security/securityEventLogger');
const { hashSecurityValue } = require('../security/redactSecurityMetadata');

const buckets = new Map();

const defaultKeyGenerator = (req = {}, action = '') => {
    const parts = [
        action,
        req.ip || req.socket?.remoteAddress || '',
        req.user?._id || req.authSession?.userId || '',
        req.params?.id || req.body?.targetUserId || '',
        req.user?.tenantId || req.body?.tenantId || '',
        req.headers?.['x-device-fingerprint'] || '',
        req.originalUrl || req.path || '',
    ];
    return hashSecurityValue(parts.join('|'), 32);
};

const getBucket = (key, windowMs) => {
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
        const next = { count: 0, resetAt: now + windowMs, severity: 'normal' };
        buckets.set(key, next);
        return next;
    }
    return current;
};

const severityForCount = (count, max) => {
    if (count > max * 4) return 'contain';
    if (count > max * 3) return 'temporary_block';
    if (count > max * 2) return 'challenge';
    if (count > max) return 'slow_down';
    return 'normal';
};

const adaptiveRateLimit = ({
    action = '',
    windowMs = 5 * 60 * 1000,
    max = 20,
    keyGenerator = defaultKeyGenerator,
} = {}) => (req, res, next) => {
    if (String(process.env.SECURITY_ADAPTIVE_RATE_LIMIT_ENABLED || 'true').trim().toLowerCase() === 'false') {
        return next();
    }

    const key = keyGenerator(req, action);
    const bucket = getBucket(key, windowMs);
    bucket.count += 1;
    bucket.severity = severityForCount(bucket.count, max);
    req.adaptiveRateLimit = {
        count: bucket.count,
        severity: bucket.severity,
        resetAt: bucket.resetAt,
    };

    if (bucket.severity === 'normal') return next();

    const decision = bucket.severity === 'slow_down'
        ? 'THROTTLE'
        : bucket.severity === 'challenge'
            ? 'CHALLENGE'
            : 'CONTAIN';

    writeSecurityEvent({
        event: bucket.severity === 'slow_down' ? 'rate.limit.hit' : 'rate.limit.escalated',
        req,
        userId: req.user?._id || req.authSession?.userId || '',
        tenantId: req.user?.tenantId || '',
        action,
        riskScore: Math.min(100, 35 + bucket.count * 5),
        decision,
        reasonCode: bucket.severity,
        metadata: {
            count: bucket.count,
            max,
            resetAt: new Date(bucket.resetAt).toISOString(),
        },
    }, { level: 'warn' });

    res.set('Cache-Control', 'no-store');
    if (bucket.severity === 'slow_down') {
        res.set('Retry-After', '30');
        return res.status(429).json({
            success: false,
            code: 'REQUEST_THROTTLED',
            message: 'Too many requests. Please try again later.',
            requestId: req.requestId || '',
        });
    }

    return res.status(403).json({
        success: false,
        code: bucket.severity === 'challenge' ? 'STEP_UP_REQUIRED' : 'ACTION_NOT_ALLOWED',
        step_up_required: bucket.severity === 'challenge',
        message: bucket.severity === 'challenge'
            ? 'Additional verification is required.'
            : 'This action is not allowed right now.',
        requestId: req.requestId || '',
    });
};

module.exports = {
    adaptiveRateLimit,
    __resetAdaptiveRateLimit: () => buckets.clear(),
};
