const crypto = require('crypto');
const logger = require('../../utils/logger');
const { flags: redisFlags, getRedisClient } = require('../../config/redis');
const { buildAuditRecord } = require('./assistantGovernanceContract');

const AUDIT_TTL_SECONDS = 24 * 60 * 60;
const memoryAuditRecords = new Map();

const createDecisionId = () => (typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `decision-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

const getAuditKey = (decisionId = '') => `${redisFlags.redisPrefix}:assistant:audit:${String(decisionId || '').trim()}`;

const pruneMemoryAuditRecords = () => {
    const cutoff = Date.now() - (AUDIT_TTL_SECONDS * 1000);
    memoryAuditRecords.forEach((entry, key) => {
        if (Number(entry?.savedAt || 0) < cutoff) {
            memoryAuditRecords.delete(key);
        }
    });
};

const persistAuditRecord = async (record = {}) => {
    const normalized = buildAuditRecord(record);
    if (!normalized.decisionId) {
        return normalized;
    }

    const payload = {
        ...normalized,
        savedAt: Date.now(),
    };

    const redis = getRedisClient();
    if (redis) {
        try {
            await redis.setEx(getAuditKey(normalized.decisionId), AUDIT_TTL_SECONDS, JSON.stringify(payload));
        } catch (error) {
            logger.warn('assistant.audit.redis_persist_failed', {
                decisionId: normalized.decisionId,
                error: error?.message || 'unknown_error',
            });
        }
    }

    pruneMemoryAuditRecords();
    memoryAuditRecords.set(normalized.decisionId, payload);
    logger.info('assistant.audit_record', normalized);
    return normalized;
};

const loadAuditRecord = async (decisionId = '') => {
    const normalizedDecisionId = String(decisionId || '').trim();
    if (!normalizedDecisionId) return null;

    const redis = getRedisClient();
    if (redis) {
        try {
            const raw = await redis.get(getAuditKey(normalizedDecisionId));
            if (raw) {
                return buildAuditRecord(JSON.parse(raw));
            }
        } catch (error) {
            logger.warn('assistant.audit.redis_load_failed', {
                decisionId: normalizedDecisionId,
                error: error?.message || 'unknown_error',
            });
        }
    }

    pruneMemoryAuditRecords();
    const record = memoryAuditRecords.get(normalizedDecisionId);
    return record ? buildAuditRecord(record) : null;
};

const __resetAssistantAuditRecordsForTests = () => {
    memoryAuditRecords.clear();
};

module.exports = {
    __resetAssistantAuditRecordsForTests,
    createDecisionId,
    loadAuditRecord,
    persistAuditRecord,
};
