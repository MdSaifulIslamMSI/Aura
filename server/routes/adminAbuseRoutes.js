const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { requireTrustDecision } = require('../trust/middleware/requireTrustDecision');
const { buildRateLimitKey } = require('../services/adminRecoveryGrantService');
const {
    addTemporaryDeny,
    getMemoryDenylistSnapshot,
    normalizeIdentity,
    removeTemporaryDeny,
} = require('../services/abuseScoreService');

const router = express.Router();

router.use(protect, admin);

const denylistWriteLimiter = createDistributedRateLimit({
    name: 'admin_abuse_denylist_write',
    windowMs: 5 * 60 * 1000,
    max: 30,
    securityCritical: true,
    keyGenerator: (req) => buildRateLimitKey('admin_abuse_denylist_write', req),
    message: {
        success: false,
        code: 'ADMIN_DENYLIST_RATE_LIMITED',
        message: 'Too many denylist changes. Wait before trying again.',
    },
});

router.get('/state', (req, res) => res.json({
    success: true,
    trafficFortressEnabled: String(process.env.TRAFFIC_FORTRESS_ENABLED || 'true').trim().toLowerCase() !== 'false',
    attackMode: String(process.env.ATTACK_MODE || 'false').trim().toLowerCase() === 'true',
    denylist: getMemoryDenylistSnapshot(),
}));

router.post('/denylist', denylistWriteLimiter, requireTrustDecision('admin.abuse.write'), sensitiveActions.adminSecurityConfigChange, async (req, res) => {
    const identity = normalizeIdentity(req.body?.identity || '');
    const parsedTtl = Number(req.body?.ttlSeconds || 900);
    const ttlSeconds = Math.min(Math.max(Number.isFinite(parsedTtl) ? parsedTtl : 900, 60), 86400);
    const reason = String(req.body?.reason || 'manual').replace(/[^A-Za-z0-9:._-]/g, '').slice(0, 80) || 'manual';
    if (!identity) {
        return res.status(400).json({ success: false, code: 'INVALID_DENYLIST_IDENTITY', message: 'A valid denylist identity is required' });
    }
    await addTemporaryDeny({ identity, ttlSeconds, reason });
    return res.status(201).json({ success: true, identity, ttlSeconds });
});

router.delete('/denylist/:identity', denylistWriteLimiter, requireTrustDecision('admin.abuse.write'), sensitiveActions.adminSecurityConfigChange, async (req, res) => {
    const identity = normalizeIdentity(req.params.identity || '');
    if (!identity) {
        return res.status(400).json({ success: false, code: 'INVALID_DENYLIST_IDENTITY', message: 'A valid denylist identity is required' });
    }
    await removeTemporaryDeny(identity);
    return res.json({ success: true, identity });
});

module.exports = router;
