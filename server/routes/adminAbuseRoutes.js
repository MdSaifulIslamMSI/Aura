const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const {
    addTemporaryDeny,
    getMemoryDenylistSnapshot,
    normalizeIdentity,
    removeTemporaryDeny,
} = require('../services/abuseScoreService');

const router = express.Router();

router.use(protect, admin);

router.get('/state', (req, res) => res.json({
    success: true,
    trafficFortressEnabled: String(process.env.TRAFFIC_FORTRESS_ENABLED || 'true').trim().toLowerCase() !== 'false',
    attackMode: String(process.env.ATTACK_MODE || 'false').trim().toLowerCase() === 'true',
    denylist: getMemoryDenylistSnapshot(),
}));

router.post('/denylist', sensitiveActions.adminSecurityConfigChange, async (req, res) => {
    const identity = normalizeIdentity(req.body?.identity || '');
    const ttlSeconds = Math.min(Math.max(Number(req.body?.ttlSeconds || 900), 60), 86400);
    const reason = String(req.body?.reason || 'manual').replace(/[^A-Za-z0-9:._-]/g, '').slice(0, 80) || 'manual';
    if (!identity) {
        return res.status(400).json({ success: false, code: 'INVALID_DENYLIST_IDENTITY' });
    }
    await addTemporaryDeny({ identity, ttlSeconds, reason });
    return res.status(201).json({ success: true, identity, ttlSeconds });
});

router.delete('/denylist/:identity', sensitiveActions.adminSecurityConfigChange, async (req, res) => {
    const identity = normalizeIdentity(req.params.identity || '');
    if (!identity) {
        return res.status(400).json({ success: false, code: 'INVALID_DENYLIST_IDENTITY' });
    }
    await removeTemporaryDeny(identity);
    return res.json({ success: true, identity });
});

module.exports = router;
