const { sendMessageToUser } = require('./socketService');

const normalizeString = (value) => String(value || '').trim();

const buildCartRealtimePayload = ({
    authUid = '',
    cart = null,
    reason = '',
    requestId = '',
    source = 'canonical_cart',
} = {}) => {
    if (!cart || typeof cart !== 'object') {
        return null;
    }

    const normalizedAuthUid = normalizeString(authUid);
    if (!normalizedAuthUid) {
        return null;
    }

    return {
        entity: 'cart',
        source: 'user',
        userId: normalizedAuthUid,
        items: Array.isArray(cart.items) ? cart.items : [],
        revision: Number(cart.version || 0),
        syncedAt: cart.updatedAt || null,
        summary: cart.summary || null,
        reason: normalizeString(reason) || 'updated',
        provider: normalizeString(source) || 'canonical_cart',
        requestId: normalizeString(requestId),
        emittedAt: new Date().toISOString(),
    };
};

const emitCartRealtimeUpdate = ({
    socketUserId = '',
    authUid = '',
    cart = null,
    reason = '',
    requestId = '',
    source = 'canonical_cart',
} = {}) => {
    const normalizedSocketUserId = normalizeString(socketUserId);
    const payload = buildCartRealtimePayload({
        authUid,
        cart,
        reason,
        requestId,
        source,
    });

    if (!normalizedSocketUserId || !payload) {
        return false;
    }

    sendMessageToUser(normalizedSocketUserId, 'cart.updated', payload);
    return true;
};

module.exports = {
    buildCartRealtimePayload,
    emitCartRealtimeUpdate,
};
