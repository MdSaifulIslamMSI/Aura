const { getRedisClient, flags: redisFlags } = require('../config/redis');
const { normalizeRoutePath } = require('../config/trafficBudgets');

const memoryDenylist = new Map();
const DENYLIST_PREFIX = `${redisFlags.redisPrefix}:traffic:deny:`;

const normalizeIdentity = (value = '') => String(value || '').trim().replace(/[^A-Za-z0-9:._-]/g, '').slice(0, 160);

const scoreRequest = (req = {}) => {
    const path = normalizeRoutePath(req.originalUrl || req.path || '/');
    const userAgent = String(req.headers?.['user-agent'] || '').toLowerCase();
    const method = String(req.method || 'GET').toUpperCase();
    const reasons = [];
    let score = 0;

    if (!userAgent) {
        score += 15;
        reasons.push('missing_user_agent');
    }
    if (/(?:sqlmap|nikto|masscan|zgrab|curl\/7|python-requests)/i.test(userAgent)) {
        score += 35;
        reasons.push('scanner_like_user_agent');
    }
    if (path.length > 220) {
        score += 15;
        reasons.push('long_path');
    }
    if (/[<>{}]|\.\.\//.test(path)) {
        score += 30;
        reasons.push('suspicious_path_tokens');
    }
    if (method !== 'GET' && req.body && typeof req.body === 'object') {
        const honeypot = String(req.body.website || req.body.companyUrl || '').trim();
        if (honeypot) {
            score += 40;
            reasons.push('honeypot_field_present');
        }
    }

    return {
        score: Math.min(score, 100),
        reasons,
        action: score >= 75 ? 'block' : (score >= 40 ? 'throttle' : 'observe'),
    };
};

const denylistKey = (identity) => `${DENYLIST_PREFIX}${normalizeIdentity(identity)}`;

const addTemporaryDeny = async ({ identity, ttlSeconds = 900, reason = 'manual' } = {}) => {
    const safeIdentity = normalizeIdentity(identity);
    if (!safeIdentity) return false;
    const expiresAt = Date.now() + (Math.max(Number(ttlSeconds || 900), 1) * 1000);
    memoryDenylist.set(safeIdentity, { reason, expiresAt });
    const client = getRedisClient();
    if (client) {
        await client.setEx(denylistKey(safeIdentity), Math.max(Number(ttlSeconds || 900), 1), JSON.stringify({ reason }));
    }
    return true;
};

const removeTemporaryDeny = async (identity) => {
    const safeIdentity = normalizeIdentity(identity);
    if (!safeIdentity) return false;
    memoryDenylist.delete(safeIdentity);
    const client = getRedisClient();
    if (client) {
        await client.del(denylistKey(safeIdentity));
    }
    return true;
};

const isDenied = async (identity) => {
    const safeIdentity = normalizeIdentity(identity);
    if (!safeIdentity) return false;
    const memoryEntry = memoryDenylist.get(safeIdentity);
    if (memoryEntry && memoryEntry.expiresAt > Date.now()) return true;
    if (memoryEntry) memoryDenylist.delete(safeIdentity);
    const client = getRedisClient();
    if (!client) return false;
    return Boolean(await client.get(denylistKey(safeIdentity)));
};

const getMemoryDenylistSnapshot = () => [...memoryDenylist.entries()]
    .filter(([, value]) => value.expiresAt > Date.now())
    .map(([identity, value]) => ({
        identity,
        reason: value.reason,
        expiresAt: new Date(value.expiresAt).toISOString(),
    }));

module.exports = {
    addTemporaryDeny,
    getMemoryDenylistSnapshot,
    isDenied,
    normalizeIdentity,
    removeTemporaryDeny,
    scoreRequest,
};
