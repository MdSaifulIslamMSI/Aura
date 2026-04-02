import { apiFetch } from '../apiBase';
import { createIdempotencyKey, getAuthHeader } from './apiUtils';

export const normalizeCartSnapshot = (payload = {}) => {
    const snapshot = payload?.cart && typeof payload.cart === 'object' && !Array.isArray(payload.cart)
        ? payload.cart
        : payload;

    return {
        items: Array.isArray(snapshot?.items) ? snapshot.items : [],
        version: Number(snapshot?.version ?? snapshot?.revision ?? 0),
        updatedAt: snapshot?.updatedAt || snapshot?.syncedAt || null,
        summary: snapshot?.summary || null,
        market: snapshot?.market || null,
    };
};

const normalizeCommandResponse = (payload = {}) => ({
    cart: normalizeCartSnapshot(payload?.cart || payload),
    appliedMutationId: String(payload?.appliedMutationId || '').trim(),
});

const normalizeConflictError = (error) => {
    if (Number(error?.status || 0) !== 409) {
        return error;
    }

    if (error?.data?.cart) {
        error.data = {
            ...error.data,
            cart: normalizeCartSnapshot(error.data.cart),
        };
        return error;
    }

    if (error?.data && typeof error.data === 'object') {
        error.data = normalizeCartSnapshot(error.data);
    }

    return error;
};

export const cartApi = {
    getCart: async ({ firebaseUser = null } = {}) => {
        const headers = await getAuthHeader(firebaseUser);
        const { data } = await apiFetch('/cart', {
            method: 'GET',
            headers,
        });

        return normalizeCartSnapshot(data);
    },

    applyCommands: async ({
        expectedVersion = null,
        clientMutationId = '',
        commands = [],
        firebaseUser = null,
    } = {}) => {
        const headers = await getAuthHeader(firebaseUser);
        const safeCommands = Array.isArray(commands) ? commands : [];

        try {
            const { data } = await apiFetch('/cart/commands', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    expectedVersion,
                    clientMutationId: String(clientMutationId || '').trim() || createIdempotencyKey('cart'),
                    commands: safeCommands,
                }),
            });

            return normalizeCommandResponse(data);
        } catch (error) {
            throw normalizeConflictError(error);
        }
    },
};
