const crypto = require('crypto');
const logger = require('../../utils/logger');
const { embedTexts } = require('./providerRegistry');

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();

const resolveQdrantUrl = () => safeString(process.env.QDRANT_URL || '');
const resolveQdrantApiKey = () => safeString(process.env.QDRANT_API_KEY || '');
const resolveCollectionName = () => {
    const prefix = safeString(process.env.QDRANT_COLLECTION_PREFIX || 'aura_code_chunks');
    return `${prefix}_assistant_memory`;
};

const qdrantHeaders = () => {
    const apiKey = resolveQdrantApiKey();
    return {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'api-key': apiKey } : {}),
    };
};

const fetchQdrant = async (path, options = {}) => {
    const baseUrl = resolveQdrantUrl();
    if (!baseUrl) {
        return null;
    }

    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
            ...qdrantHeaders(),
            ...(options.headers || {}),
        },
    });
    return response;
};

const ensureCollection = async (vectorSize = 0) => {
    const collection = resolveCollectionName();
    const getResponse = await fetchQdrant(`/collections/${collection}`, {
        method: 'GET',
    }).catch(() => null);
    if (getResponse?.ok) {
        return true;
    }

    if (!vectorSize) {
        return false;
    }

    const distance = safeString(process.env.QDRANT_DISTANCE || 'Cosine');
    const createResponse = await fetchQdrant(`/collections/${collection}`, {
        method: 'PUT',
        body: JSON.stringify({
            vectors: {
                size: vectorSize,
                distance,
            },
        }),
    }).catch(() => null);

    return Boolean(createResponse?.ok);
};

const normalizeTurnPayload = ({
    user = null,
    message = '',
    result = {},
    decision = {},
} = {}) => {
    const assistantTurn = result?.assistantTurn || {};
    const citations = Array.isArray(assistantTurn?.citations) ? assistantTurn.citations : [];
    const actions = Array.isArray(assistantTurn?.actions) ? assistantTurn.actions : [];
    return {
        userId: safeString(user?._id || ''),
        message: safeString(message),
        intent: safeString(assistantTurn?.intent || ''),
        response: safeString(result?.answer || assistantTurn?.response || ''),
        route: safeString(decision?.route || ''),
        entities: assistantTurn?.entities && typeof assistantTurn.entities === 'object'
            ? assistantTurn.entities
            : {},
        citations: citations.slice(0, 4).map((citation) => ({
            label: safeString(citation?.label || ''),
            path: safeString(citation?.path || ''),
            type: safeString(citation?.type || ''),
        })),
        actions: actions.slice(0, 4).map((action) => ({
            type: safeString(action?.type || ''),
            productId: safeString(action?.productId || ''),
            page: safeString(action?.page || ''),
            orderId: safeString(action?.orderId || ''),
        })),
        verified: Boolean(assistantTurn?.verification?.label && assistantTurn.verification.label !== 'cannot_verify'),
        verificationLabel: safeString(assistantTurn?.verification?.label || ''),
        recordedAt: new Date().toISOString(),
    };
};

const buildMemoryDocument = (payload = {}) => ([
    `user:${safeString(payload.userId || 'anonymous') || 'anonymous'}`,
    `route:${safeString(payload.route || 'LOCAL') || 'LOCAL'}`,
    `intent:${safeString(payload.intent || 'unknown') || 'unknown'}`,
    `message:${safeString(payload.message || '')}`,
    `response:${safeString(payload.response || '')}`,
    payload.citations?.length ? `citations:${payload.citations.map((entry) => safeString(entry.label || entry.path)).filter(Boolean).join('; ')}` : '',
    payload.actions?.length ? `actions:${payload.actions.map((entry) => safeString(entry.type)).filter(Boolean).join(', ')}` : '',
].filter(Boolean).join('\n'));

const recordSemanticMemory = async ({
    user = null,
    message = '',
    result = {},
    decision = {},
    decisionId = '',
} = {}) => {
    if (!resolveQdrantUrl() || typeof embedTexts !== 'function') {
        return false;
    }

    const payload = normalizeTurnPayload({
        user,
        message,
        result,
        decision,
    });
    if (!payload.message || !payload.response) {
        return false;
    }

    try {
        const [embedding] = await embedTexts([buildMemoryDocument(payload)]);
        if (!Array.isArray(embedding) || embedding.length === 0) {
            return false;
        }

        const collectionReady = await ensureCollection(embedding.length);
        if (!collectionReady) {
            return false;
        }

        const pointId = safeString(decisionId || crypto.randomUUID?.() || crypto.createHash('sha256')
            .update(`${payload.recordedAt}-${payload.message}`)
            .digest('hex')
            .slice(0, 24));
        const response = await fetchQdrant(`/collections/${resolveCollectionName()}/points?wait=true`, {
            method: 'PUT',
            body: JSON.stringify({
                points: [
                    {
                        id: pointId,
                        vector: embedding,
                        payload,
                    },
                ],
            }),
        });

        if (!response?.ok) {
            logger.warn('assistant.semantic_memory_upsert_failed', {
                status: response?.status || 0,
                decisionId: safeString(decisionId || ''),
            });
            return false;
        }

        return true;
    } catch (error) {
        logger.warn('assistant.semantic_memory_write_failed', {
            error: error?.message || 'unknown_error',
            decisionId: safeString(decisionId || ''),
        });
        return false;
    }
};

module.exports = {
    recordSemanticMemory,
};
