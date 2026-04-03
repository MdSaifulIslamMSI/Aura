const crypto = require('crypto');
const { flags: redisFlags, getRedisClient } = require('../../config/redis');
const { flags: assistantFlags } = require('../../config/assistantFlags');

const memorySessions = new Map();

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const createSessionId = () => (typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `assistant-v2-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

const createExpiryIso = (ttlSeconds = assistantFlags.assistantV2SessionTtlSeconds) => new Date(
    Date.now() + (Math.max(60, Number(ttlSeconds || assistantFlags.assistantV2SessionTtlSeconds)) * 1000)
).toISOString();

const createEmptySession = (sessionId = createSessionId()) => {
    const now = new Date().toISOString();
    return {
        id: safeString(sessionId),
        createdAt: now,
        updatedAt: now,
        expiresAt: createExpiryIso(),
        turnCount: 0,
        lastIntent: 'general_help',
        lastRouteContext: null,
        lastCommerceContext: null,
        lastUserContext: null,
        lastProductIds: [],
        activeProductId: '',
        lastQuery: '',
        lastSupportDraft: null,
    };
};

const getSessionKey = (sessionId) => `${redisFlags.redisPrefix}:assistant:v2:session:${safeString(sessionId)}`;

const pruneExpiredMemorySessions = () => {
    const now = Date.now();
    memorySessions.forEach((entry, key) => {
        const expiresAt = new Date(entry?.expiresAt || 0).getTime();
        if (!Number.isFinite(expiresAt) || expiresAt <= now) {
            memorySessions.delete(key);
        }
    });
};

const readMemorySession = (sessionId) => {
    pruneExpiredMemorySessions();
    const session = memorySessions.get(safeString(sessionId));
    return session ? { ...session } : null;
};

const writeMemorySession = (session) => {
    memorySessions.set(safeString(session.id), { ...session });
    return session;
};

const readRedisSession = async (sessionId) => {
    const client = getRedisClient();
    if (!client) return null;

    const raw = await client.get(getSessionKey(sessionId));
    if (!raw) return null;

    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

const writeRedisSession = async (session, ttlSeconds = assistantFlags.assistantV2SessionTtlSeconds) => {
    const client = getRedisClient();
    if (!client) return null;

    await client.setEx(
        getSessionKey(session.id),
        Math.max(60, Number(ttlSeconds || assistantFlags.assistantV2SessionTtlSeconds)),
        JSON.stringify(session)
    );

    return session;
};

const loadAssistantSession = async (sessionId = '') => {
    const normalizedId = safeString(sessionId);
    if (!normalizedId) return null;

    const fromRedis = await readRedisSession(normalizedId);
    if (fromRedis) return fromRedis;

    return readMemorySession(normalizedId);
};

const resolveAssistantSession = async (sessionId = '') => {
    const existing = await loadAssistantSession(sessionId);
    if (existing) {
        return existing;
    }

    return createEmptySession(sessionId || createSessionId());
};

const saveAssistantSession = async (session, ttlSeconds = assistantFlags.assistantV2SessionTtlSeconds) => {
    const nextSession = {
        ...session,
        id: safeString(session?.id || createSessionId()),
        updatedAt: new Date().toISOString(),
        expiresAt: createExpiryIso(ttlSeconds),
    };

    const writtenRedis = await writeRedisSession(nextSession, ttlSeconds);
    if (writtenRedis) return writtenRedis;

    return writeMemorySession(nextSession);
};

const __resetAssistantSessionsForTests = () => {
    memorySessions.clear();
};

module.exports = {
    __resetAssistantSessionsForTests,
    createEmptySession,
    loadAssistantSession,
    resolveAssistantSession,
    saveAssistantSession,
};
