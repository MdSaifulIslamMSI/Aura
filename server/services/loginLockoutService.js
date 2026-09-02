const { getRedisClient, flags: redisFlags } = require('../config/redis');
const { writeSecurityEvent } = require('../security/securityEventLogger');
const { hashSecurityValue } = require('../security/redactSecurityMetadata');
const logger = require('../utils/logger');

// Phase 5A "brute-force death": distributed per-account lockout for the
// server-side auth surfaces (OTP verify, MFA verify, recovery codes, session
// sync). Login itself is Firebase-verified, so the server-side brute-force
// targets are one-time proofs; repeated 401s on those routes are the signal.
//
// Rollout mirrors the login risk engine: AUTH_LOCKOUT_MODE=off (default) |
// monitor (observe + log, never block) | enforce (locked accounts get 429).
// Failure: lockout evaluation fails open for availability (a Redis blip must
// not brick every login); the distributed rate limiters remain the hard cap.

const MODES = Object.freeze(['off', 'monitor', 'enforce']);
const DEFAULT_MODE = 'off';

const FAILURE_WINDOW_MS = Number(process.env.AUTH_LOCKOUT_WINDOW_MS || 15 * 60 * 1000);
const LOCKOUT_STEPS = Object.freeze([
    { minFailures: 5, lockMs: 5 * 60 * 1000 },
    { minFailures: 8, lockMs: 15 * 60 * 1000 },
    { minFailures: 12, lockMs: 60 * 60 * 1000 },
]);
const MAX_TRACKED_FAILURES = 1000;

const memoryStore = new Map();
let memoryCleanupTimer = null;

const parseMode = () => {
    const normalized = String(process.env.AUTH_LOCKOUT_MODE || DEFAULT_MODE).trim().toLowerCase();
    return MODES.includes(normalized) ? normalized : DEFAULT_MODE;
};

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizePhone = (value) => String(value || '').trim().replace(/[\s\-()]/g, '');

const buildAccountKey = ({ uid = '', email = '', phone = '', ip = '' } = {}) => {
    const identity = normalizeEmail(email) || normalizePhone(phone);
    const parts = [
        identity ? `id:${identity}` : '',
        uid ? `uid:${uid}` : '',
        ip ? `ip:${ip}` : '',
    ].filter(Boolean);
    return hashSecurityValue(parts.join('|') || 'anonymous', 32);
};

const accountKeyFromRequest = (req = {}) => buildAccountKey({
    uid: req.authUid || req.user?._id || '',
    email: req.body?.email || req.user?.email || '',
    phone: req.body?.phone || '',
    ip: req.ip || req.socket?.remoteAddress || '',
});

const scheduleMemoryCleanup = () => {
    if (memoryCleanupTimer) return;
    memoryCleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of memoryStore.entries()) {
            if (entry.windowResetAt <= now && entry.lockUntil <= now) {
                memoryStore.delete(key);
            }
        }
    }, 60 * 1000);
    if (typeof memoryCleanupTimer.unref === 'function') {
        memoryCleanupTimer.unref();
    }
};

const storeKey = (accountKey, suffix) => `${redisFlags.redisPrefix}:lockout:${accountKey}${suffix}`;

const sendCommand = async (client, args) => {
    if (typeof client.sendCommand === 'function') {
        return client.sendCommand(args);
    }
    throw new Error('redis client does not support sendCommand');
};

const resolveLockMs = (failures) => {
    let lockMs = 0;
    for (const step of LOCKOUT_STEPS) {
        if (failures >= step.minFailures) lockMs = step.lockMs;
    }
    return lockMs;
};

const readMemoryEntry = (accountKey) => {
    scheduleMemoryCleanup();
    const now = Date.now();
    let entry = memoryStore.get(accountKey);
    if (!entry || entry.windowResetAt <= now) {
        entry = { failures: 0, windowResetAt: now + FAILURE_WINDOW_MS, lockUntil: 0 };
        memoryStore.set(accountKey, entry);
    }
    return entry;
};

module.exports = {
    MODES,
    DEFAULT_MODE,
    FAILURE_WINDOW_MS,
    LOCKOUT_STEPS,
    buildAccountKey,
    accountKeyFromRequest,
    parseMode,
    resolveLockMs,
    readMemoryEntry,
    storeKey,
    sendCommand,
};

// Records a failed authentication attempt for the account. Returns the
// resulting lock decision; never throws (failure recording must not break
// the auth response path).
const recordAuthFailure = async ({ uid = '', email = '', phone = '', ip = '', surface = 'auth', req = null } = {}) => {
    const accountKey = buildAccountKey({ uid, email, phone, ip });
    const now = Date.now();
    let failures = 0;
    let lockMs = 0;
    let locked = false;

    try {
        const client = getRedisClient();
        if (client) {
            const counterKey = storeKey(accountKey, ':failures');
            const countRaw = await sendCommand(client, ['INCR', counterKey]);
            failures = Number(countRaw) || 0;
            if (failures === 1) {
                await sendCommand(client, ['PEXPIRE', counterKey, String(FAILURE_WINDOW_MS)]);
            }
            failures = Math.min(failures, MAX_TRACKED_FAILURES);
            lockMs = resolveLockMs(failures);
            if (lockMs > 0) {
                const lockKey = storeKey(accountKey, ':lock');
                await sendCommand(client, ['SET', lockKey, String(now + lockMs), 'PX', String(lockMs)]);
                locked = true;
            }
        } else {
            const entry = readMemoryEntry(accountKey);
            entry.failures = Math.min(entry.failures + 1, MAX_TRACKED_FAILURES);
            failures = entry.failures;
            lockMs = resolveLockMs(failures);
            if (lockMs > 0) {
                entry.lockUntil = now + lockMs;
                locked = true;
            }
        }
    } catch (error) {
        logger.warn('login_lockout.record_failure_failed', { error: error?.message || 'unknown' });
        return { failures: 0, lockMs: 0, locked: false, degraded: true };
    }

    if (locked || failures >= LOCKOUT_STEPS[0].minFailures) {
        writeSecurityEvent({
            event: locked ? 'auth.lockout.engaged' : 'auth.lockout.threshold_approaching',
            req,
            action: surface,
            riskScore: Math.min(100, 20 + failures * 6),
            decision: locked ? 'LOCK' : 'WATCH',
            reasonCode: 'failed_auth_attempts',
            metadata: { failures, lockMs, surface, mode: parseMode() },
        }, { level: locked ? 'warn' : 'info' });
    }

    return { failures, lockMs, locked };
};

// Evaluates the current lock state for an account. Fails open (locked=false)
// when the store is unavailable so a Redis blip cannot brick every login.
const evaluateAccountLockout = async ({ uid = '', email = '', phone = '', ip = '' } = {}) => {
    const mode = parseMode();
    const accountKey = buildAccountKey({ uid, email, phone, ip });
    const base = { mode, accountKey, locked: false, failures: 0, lockMs: 0, retryAfterMs: 0 };

    try {
        const client = getRedisClient();
        if (client) {
            const lockRaw = await sendCommand(client, ['GET', storeKey(accountKey, ':lock')]);
            const lockUntil = Number(lockRaw) || 0;
            if (lockUntil > Date.now()) {
                return { ...base, locked: true, retryAfterMs: lockUntil - Date.now() };
            }
            const countRaw = await sendCommand(client, ['GET', storeKey(accountKey, ':failures')]);
            return { ...base, failures: Number(countRaw) || 0 };
        }

        const entry = readMemoryEntry(accountKey);
        if (entry.lockUntil > Date.now()) {
            return { ...base, locked: true, failures: entry.failures, retryAfterMs: entry.lockUntil - Date.now() };
        }
        return { ...base, failures: entry.failures };
    } catch (error) {
        logger.warn('login_lockout.evaluate_failed', { error: error?.message || 'unknown' });
        return { ...base, degraded: true };
    }
};

// Clears counters after a successful authentication so legitimate users who
// fail once (typo, expired code) never accumulate toward a lock.
const recordAuthSuccess = async ({ uid = '', email = '', phone = '', ip = '' } = {}) => {
    const accountKey = buildAccountKey({ uid, email, phone, ip });
    try {
        const client = getRedisClient();
        if (client) {
            await sendCommand(client, ['DEL', storeKey(accountKey, ':failures'), storeKey(accountKey, ':lock')]);
            return;
        }
        memoryStore.delete(accountKey);
    } catch (error) {
        logger.warn('login_lockout.record_success_failed', { error: error?.message || 'unknown' });
    }
};

module.exports.recordAuthFailure = recordAuthFailure;
module.exports.evaluateAccountLockout = evaluateAccountLockout;
module.exports.recordAuthSuccess = recordAuthSuccess;

