const { getRedisClient, flags: redisFlags } = require('../config/redis');
const { hashSecurityValue } = require('../security/redactSecurityMetadata');
const logger = require('../utils/logger');

// Phase 5B: cross-request behavioral baseline. Risk signals were previously
// per-request only, so low-and-slow attackers rotating IPs below every
// threshold were invisible. This persists a lightweight per-account view in
// Redis: distinct source IPs over a 1-hour window and attempt velocity over a
// 15-minute window, both fed into the login risk engine as additional signals.
//
// Flag: AUTH_BEHAVIOR_BASELINE_ENABLED=true. Redis failures fail open (no
// signal) exactly like the lockout evaluation.

const IP_WINDOW_MS = 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const IP_DIVERSITY_SIGNAL_THRESHOLD = 3;

const isBehaviorBaselineEnabled = () => (
    String(process.env.AUTH_BEHAVIOR_BASELINE_ENABLED || '').trim().toLowerCase() === 'true'
);

const buildUidKey = (uid = '') => hashSecurityValue(String(uid || ''), 24);

const sendCommand = async (client, args) => {
    if (typeof client.sendCommand === 'function') {
        return client.sendCommand(args);
    }
    throw new Error('redis client does not support sendCommand');
};

// Records one auth attempt observation for the account. Never throws.
const recordAuthObservation = async ({ uid = '', ip = '' } = {}) => {
    if (!isBehaviorBaselineEnabled() || !uid) {
        return { enabled: false, recorded: false };
    }
    const ipHash = hashSecurityValue(String(ip || ''), 24);
    const ipSetKey = `${redisFlags.redisPrefix}:behavior:${buildUidKey(uid)}:ips`;
    const attemptsKey = `${redisFlags.redisPrefix}:behavior:${buildUidKey(uid)}:attempts`;
    try {
        const client = getRedisClient();
        if (!client) {
            return { enabled: true, recorded: false, degraded: true };
        }
        await sendCommand(client, ['SADD', ipSetKey, ipHash]);
        await sendCommand(client, ['PEXPIRE', ipSetKey, String(IP_WINDOW_MS)]);
        const countRaw = await sendCommand(client, ['INCR', attemptsKey]);
        if (Number(countRaw) === 1) {
            await sendCommand(client, ['PEXPIRE', attemptsKey, String(ATTEMPT_WINDOW_MS)]);
        }
        return { enabled: true, recorded: true };
    } catch (error) {
        logger.warn('auth_baseline.record_failed', { error: error?.message || 'unknown' });
        return { enabled: true, recorded: false, degraded: true };
    }
};

// Evaluates behavioral signals for the account. Never throws; fails open.
const evaluateBehaviorSignals = async ({ uid = '' } = {}) => {
    const empty = {
        enabled: isBehaviorBaselineEnabled(),
        distinctIpCount: 0,
        attempts15m: 0,
        degraded: false,
    };
    if (!empty.enabled || !uid) {
        return empty;
    }
    const uidKey = buildUidKey(uid);
    try {
        const client = getRedisClient();
        if (!client) {
            return { ...empty, degraded: true };
        }
        const ipCountRaw = await sendCommand(client, ['SCARD', `${redisFlags.redisPrefix}:behavior:${uidKey}:ips`]);
        const attemptsRaw = await sendCommand(client, ['GET', `${redisFlags.redisPrefix}:behavior:${uidKey}:attempts`]);
        return {
            ...empty,
            distinctIpCount: Number(ipCountRaw) || 0,
            attempts15m: Number(attemptsRaw) || 0,
        };
    } catch (error) {
        logger.warn('auth_baseline.evaluate_failed', { error: error?.message || 'unknown' });
        return { ...empty, degraded: true };
    }
};

module.exports = {
    ATTEMPT_WINDOW_MS,
    IP_DIVERSITY_SIGNAL_THRESHOLD,
    IP_WINDOW_MS,
    buildUidKey,
    evaluateBehaviorSignals,
    isBehaviorBaselineEnabled,
    recordAuthObservation,
};
