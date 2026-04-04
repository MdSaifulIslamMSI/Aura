const crypto = require('crypto');
const { flags: redisFlags, getRedisClient } = require('../../config/redis');

const SESSION_TTL_SECONDS = 30 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
const MAX_EXECUTED_ACTION_IDS = 24;
const memorySessions = new Map();

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const clamp = (value, min, max) => Math.min(Math.max(Number(value) || 0, min), max);

const normalizeEntities = (value = {}) => ({
    query: safeString(value?.query || ''),
    productId: safeString(value?.productId || ''),
    category: safeString(value?.category || ''),
    priceMin: Math.max(0, Number(value?.priceMin || 0)),
    maxPrice: Math.max(0, Number(value?.maxPrice || 0)),
    quantity: Math.max(0, Number(value?.quantity || 0)),
    limit: Math.max(0, Number(value?.limit || 0)),
});

const normalizeClarificationState = (value = {}) => ({
    fingerprint: safeString(value?.fingerprint || ''),
    count: Math.max(0, Number(value?.count || 0)),
    lastQuestion: safeString(value?.lastQuestion || ''),
});

const normalizePendingAction = (value = null) => {
    if (!value || typeof value !== 'object') return null;

    return {
        actionId: safeString(value?.actionId || ''),
        actionType: safeString(value?.actionType || ''),
        risk: safeString(value?.risk || ''),
        contextVersion: Math.max(0, Number(value?.contextVersion || 0)),
        intent: safeString(value?.intent || ''),
        message: safeString(value?.message || ''),
        action: value?.action && typeof value.action === 'object'
            ? {
                ...value.action,
                type: safeString(value.action?.type || ''),
            }
            : null,
        entities: normalizeEntities(value?.entities || {}),
        createdAt: Math.max(0, Number(value?.createdAt || 0)),
    };
};

const normalizeProductSummary = (product = {}) => {
    const id = safeString(product?.id || product?._id || '');
    if (!id) return null;

    return {
        id,
        title: safeString(product?.displayTitle || product?.title || product?.name || 'Untitled product'),
        brand: safeString(product?.brand || ''),
        category: safeString(product?.category || ''),
        price: Number(product?.price || 0),
        originalPrice: Number(product?.originalPrice || product?.price || 0),
        discountPercentage: Number(product?.discountPercentage || 0),
        image: safeString(product?.image || product?.thumbnail || ''),
        stock: Math.max(0, Number(product?.stock || 0)),
        rating: Number(product?.rating || 0),
        ratingCount: Number(product?.ratingCount || 0),
    };
};

const normalizeProducts = (products = []) => {
    const seen = new Set();
    return (Array.isArray(products) ? products : [])
        .map((product) => normalizeProductSummary(product))
        .filter(Boolean)
        .filter((product) => {
            if (seen.has(product.id)) return false;
            seen.add(product.id);
            return true;
        })
        .slice(0, 6);
};

const buildBootstrapSnapshot = (context = {}) => {
    const assistantSession = context?.assistantSession && typeof context.assistantSession === 'object'
        ? context.assistantSession
        : {};
    const legacyMemory = context?.sessionMemory && typeof context.sessionMemory === 'object'
        ? context.sessionMemory
        : {};
    const activeProductId = safeString(
        assistantSession?.lastResolvedEntityId
        || legacyMemory?.activeProduct?.id
        || legacyMemory?.lastResults?.[0]?.id
        || context?.currentProductId
        || ''
    );

    return {
        lastIntent: safeString(assistantSession?.lastIntent || legacyMemory?.lastIntent || legacyMemory?.currentIntent || ''),
        lastEntities: normalizeEntities({
            query: assistantSession?.lastEntities?.query || legacyMemory?.lastQuery || '',
            productId: assistantSession?.lastEntities?.productId || activeProductId,
            category: assistantSession?.lastEntities?.category || context?.category || '',
            priceMin: assistantSession?.lastEntities?.priceMin || 0,
            maxPrice: assistantSession?.lastEntities?.maxPrice || 0,
            quantity: assistantSession?.lastEntities?.quantity || 0,
            limit: assistantSession?.lastEntities?.limit || 0,
        }),
        contextPath: safeString(assistantSession?.contextPath || context?.route || context?.routeLabel || context?.category || ''),
        clarificationState: normalizeClarificationState(assistantSession?.clarificationState || legacyMemory?.clarificationState || {}),
        lastResolvedEntityId: activeProductId,
        lastResults: normalizeProducts(assistantSession?.lastResults || legacyMemory?.lastResults || context?.latestProducts || []),
        activeProduct: normalizeProductSummary(assistantSession?.activeProduct || legacyMemory?.activeProduct || context?.currentProduct || null),
        pendingAction: normalizePendingAction(assistantSession?.pendingAction || null),
    };
};

const createSessionId = () => {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return crypto.createHash('sha256')
        .update(`${Date.now()}-${Math.random().toString(36).slice(2)}`)
        .digest('hex')
        .slice(0, 24);
};

const cloneSession = (session = {}) => ({
    sessionId: safeString(session?.sessionId || ''),
    contextVersion: Math.max(1, Number(session?.contextVersion || 1)),
    lastIntent: safeString(session?.lastIntent || ''),
    lastEntities: normalizeEntities(session?.lastEntities || {}),
    contextPath: safeString(session?.contextPath || ''),
    pendingAction: normalizePendingAction(session?.pendingAction || null),
    clarificationState: normalizeClarificationState(session?.clarificationState || {}),
    lastResolvedEntityId: safeString(session?.lastResolvedEntityId || ''),
    lastResults: normalizeProducts(session?.lastResults || []),
    activeProduct: normalizeProductSummary(session?.activeProduct || null),
    executedActionIds: Array.isArray(session?.executedActionIds)
        ? session.executedActionIds.map((entry) => safeString(entry)).filter(Boolean).slice(-MAX_EXECUTED_ACTION_IDS)
        : [],
    updatedAt: Math.max(0, Number(session?.updatedAt || Date.now())),
});

const getSessionKey = (sessionId = '') => `${redisFlags.redisPrefix}:assistant:session:${safeString(sessionId)}`;

const pruneExpiredMemorySessions = () => {
    const cutoff = Date.now() - SESSION_TTL_MS;
    memorySessions.forEach((entry, key) => {
        if (Number(entry?.updatedAt || 0) < cutoff) {
            memorySessions.delete(key);
        }
    });
};

const readMemorySession = (sessionId = '') => {
    pruneExpiredMemorySessions();
    const session = memorySessions.get(safeString(sessionId));
    return session ? cloneSession(session) : null;
};

const writeMemorySession = (session = {}) => {
    const normalized = cloneSession(session);
    memorySessions.set(normalized.sessionId, normalized);
    return cloneSession(normalized);
};

const readRedisSession = async (sessionId = '') => {
    const client = getRedisClient();
    if (!client) return null;

    try {
        const raw = await client.get(getSessionKey(sessionId));
        if (!raw) return null;
        return cloneSession(JSON.parse(raw));
    } catch {
        return null;
    }
};

const writeRedisSession = async (session = {}) => {
    const client = getRedisClient();
    if (!client) return null;

    const normalized = cloneSession(session);
    await client.setEx(
        getSessionKey(normalized.sessionId),
        SESSION_TTL_SECONDS,
        JSON.stringify(normalized)
    );
    return cloneSession(normalized);
};

const persistSession = async (session = {}) => {
    const normalized = cloneSession(session);
    try {
        const written = await writeRedisSession(normalized);
        if (written) {
            return cloneSession(written);
        }
    } catch {
        // Fall back to memory storage below.
    }
    return writeMemorySession(normalized);
};

const resolveAssistantSession = async ({ sessionId = '', context = {} } = {}) => {
    const normalizedSessionId = safeString(sessionId);
    const fromRedis = normalizedSessionId ? await readRedisSession(normalizedSessionId) : null;
    if (fromRedis) {
        return cloneSession(fromRedis);
    }

    const fromMemory = normalizedSessionId ? readMemorySession(normalizedSessionId) : null;
    if (fromMemory) {
        return cloneSession(fromMemory);
    }

    const bootstrap = buildBootstrapSnapshot(context);
    return persistSession({
        sessionId: normalizedSessionId || createSessionId(),
        contextVersion: Math.max(1, Number(context?.assistantSession?.contextVersion || 1)),
        ...bootstrap,
        executedActionIds: [],
        updatedAt: Date.now(),
    });
};

const updateAssistantSession = async ({ sessionId = '', baseSession = null, patch = {} } = {}) => {
    const current = baseSession?.sessionId
        ? cloneSession(baseSession)
        : await resolveAssistantSession({ sessionId });
    const nextContextVersion = patch?.contextVersion !== undefined
        ? Math.max(1, Number(patch.contextVersion || current.contextVersion))
        : patch?.incrementContextVersion
            ? current.contextVersion + 1
            : current.contextVersion;
    const nextExecutedActionIds = patch?.executedActionIds
        ? patch.executedActionIds
        : current.executedActionIds;

    return persistSession({
        ...current,
        sessionId: current.sessionId,
        contextVersion: nextContextVersion,
        lastIntent: patch?.lastIntent !== undefined ? safeString(patch.lastIntent) : current.lastIntent,
        lastEntities: patch?.lastEntities ? normalizeEntities(patch.lastEntities) : current.lastEntities,
        contextPath: patch?.contextPath !== undefined ? safeString(patch.contextPath) : current.contextPath,
        pendingAction: patch?.pendingAction !== undefined
            ? normalizePendingAction(patch.pendingAction)
            : current.pendingAction,
        clarificationState: patch?.clarificationState
            ? normalizeClarificationState(patch.clarificationState)
            : current.clarificationState,
        lastResolvedEntityId: patch?.lastResolvedEntityId !== undefined
            ? safeString(patch.lastResolvedEntityId)
            : current.lastResolvedEntityId,
        lastResults: patch?.lastResults !== undefined
            ? normalizeProducts(patch.lastResults)
            : current.lastResults,
        activeProduct: patch?.activeProduct !== undefined
            ? normalizeProductSummary(patch.activeProduct)
            : current.activeProduct,
        executedActionIds: Array.isArray(nextExecutedActionIds)
            ? nextExecutedActionIds.map((entry) => safeString(entry)).filter(Boolean).slice(-MAX_EXECUTED_ACTION_IDS)
            : current.executedActionIds,
        updatedAt: Date.now(),
    });
};

const createActionId = ({
    intent = '',
    entities = {},
    contextVersion = 0,
    seed = Date.now(),
} = {}) => crypto.createHash('sha256')
    .update(JSON.stringify({
        intent: safeString(intent),
        entities: normalizeEntities(entities),
        contextVersion: Math.max(0, Number(contextVersion || 0)),
        seed: clamp(seed, 0, Number.MAX_SAFE_INTEGER),
    }))
    .digest('hex')
    .slice(0, 24);

const validatePendingAction = async ({
    session = {},
    actionId = '',
    contextVersion = 0,
} = {}) => {
    const pendingAction = normalizePendingAction(session?.pendingAction || null);
    const normalizedActionId = safeString(actionId);
    if (!pendingAction?.actionId || pendingAction.actionId !== normalizedActionId) {
        return {
            ok: false,
            reason: 'pending_action_missing',
            pendingAction: null,
        };
    }

    if (
        contextVersion
        && Number(pendingAction.contextVersion || 0) > 0
        && Number(contextVersion) !== Number(pendingAction.contextVersion)
    ) {
        return {
            ok: false,
            reason: 'context_version_mismatch',
            pendingAction,
        };
    }

    if ((session?.executedActionIds || []).includes(normalizedActionId)) {
        return {
            ok: false,
            reason: 'already_executed',
            pendingAction,
        };
    }

    return {
        ok: true,
        reason: '',
        pendingAction,
    };
};

const markActionExecuted = async ({ sessionId = '', baseSession = null, actionId = '' } = {}) => {
    const current = baseSession?.sessionId
        ? cloneSession(baseSession)
        : await resolveAssistantSession({ sessionId });
    const normalizedActionId = safeString(actionId);
    if (!normalizedActionId) {
        return current;
    }

    return updateAssistantSession({
        sessionId: current.sessionId,
        baseSession: current,
        patch: {
            pendingAction: null,
            executedActionIds: [...current.executedActionIds, normalizedActionId].slice(-MAX_EXECUTED_ACTION_IDS),
            incrementContextVersion: true,
        },
    });
};

const toSessionMemory = (session = {}) => ({
    lastQuery: safeString(session?.lastEntities?.query || ''),
    lastResults: normalizeProducts(session?.lastResults || []),
    activeProduct: normalizeProductSummary(session?.activeProduct || null)
        || (session?.lastResolvedEntityId ? { id: safeString(session.lastResolvedEntityId) } : null),
    lastIntent: safeString(session?.lastIntent || ''),
    currentIntent: safeString(session?.lastIntent || ''),
    clarificationState: normalizeClarificationState(session?.clarificationState || {}),
    lastResolvedEntityId: safeString(session?.lastResolvedEntityId || ''),
    pendingAction: normalizePendingAction(session?.pendingAction || null),
    executedActionIds: Array.isArray(session?.executedActionIds)
        ? session.executedActionIds.map((entry) => safeString(entry)).filter(Boolean).slice(-MAX_EXECUTED_ACTION_IDS)
        : [],
});

const __resetAssistantSessionsForTests = () => {
    memorySessions.clear();
};

module.exports = {
    __resetAssistantSessionsForTests,
    createActionId,
    markActionExecuted,
    resolveAssistantSession,
    toSessionMemory,
    updateAssistantSession,
    validatePendingAction,
};
