import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../apiBase', () => ({
    apiFetch: vi.fn(async () => ({ data: {} })),
    buildServiceUrl: vi.fn((path) => `http://test.local${path}`),
}));
vi.mock('./apiUtils', () => ({
    getAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer test' })),
    createIdempotencyKey: vi.fn((prefix) => `${prefix}-fixed`),
}));

import { apiFetch } from '../apiBase';
import { createIdempotencyKey } from './apiUtils';
import { cartApi, normalizeCartSnapshot } from './cartApi';

const lastCall = () => {
    const calls = apiFetch.mock.calls;
    return calls[calls.length - 1];
};

beforeEach(() => {
    apiFetch.mockClear();
    createIdempotencyKey.mockClear();
    apiFetch.mockImplementation(async () => ({ data: {} }));
});

describe('normalizeCartSnapshot', () => {
    it('unwraps a nested cart payload', () => {
        expect(normalizeCartSnapshot({
            cart: {
                items: [{ id: 'a' }],
                version: '3',
                updatedAt: '2026-01-01T00:00:00Z',
                summary: { total: 9 },
                market: { country: 'US' },
            },
            appliedMutationId: 'm1',
        })).toEqual({
            items: [{ id: 'a' }],
            version: 3,
            updatedAt: '2026-01-01T00:00:00Z',
            summary: { total: 9 },
            market: { country: 'US' },
        });
    });

    it('falls back to revision and syncedAt fields', () => {
        const snapshot = normalizeCartSnapshot({ items: [], revision: 11, syncedAt: 't0' });
        expect(snapshot.version).toBe(11);
        expect(snapshot.updatedAt).toBe('t0');
    });

    it('fills safe defaults for missing or malformed payloads', () => {
        expect(normalizeCartSnapshot({})).toEqual({
            items: [],
            version: 0,
            updatedAt: null,
            summary: null,
            market: null,
        });
        expect(normalizeCartSnapshot({ cart: ['not', 'an', 'object'] }).items).toEqual([]);
        expect(normalizeCartSnapshot({ items: 'nope' }).items).toEqual([]);
    });
});

describe('cartApi.getCart', () => {
    it('GETs /cart with auth headers and normalizes the snapshot', async () => {
        apiFetch.mockResolvedValue({ data: { cart: { items: [{ id: 1 }], version: 2 } } });
        const snapshot = await cartApi.getCart({ firebaseUser: { uid: 'u1' } });

        const [path, options] = lastCall();
        expect(path).toBe('/cart');
        expect(options.method).toBe('GET');
        expect(options.headers.Authorization).toBe('Bearer test');
        expect(snapshot).toMatchObject({ items: [{ id: 1 }], version: 2 });
    });
});

describe('cartApi.applyCommands', () => {
    it('POSTs the command envelope with the caller mutation id', async () => {
        apiFetch.mockResolvedValue({ data: { cart: { version: 4 }, appliedMutationId: 'm9' } });
        const response = await cartApi.applyCommands({
            expectedVersion: 3,
            clientMutationId: ' mutation-1 ',
            commands: [{ type: 'add', listingId: 'l1' }],
            firebaseUser: null,
        });

        const [path, options] = lastCall();
        expect(path).toBe('/cart/commands');
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({
            expectedVersion: 3,
            clientMutationId: 'mutation-1',
            commands: [{ type: 'add', listingId: 'l1' }],
        });
        expect(response.appliedMutationId).toBe('m9');
        expect(response.cart.version).toBe(4);
        expect(createIdempotencyKey).not.toHaveBeenCalled();
    });

    it('mints an idempotency key when the client mutation id is blank', async () => {
        await cartApi.applyCommands({ clientMutationId: '   ' });
        const [, options] = lastCall();
        expect(JSON.parse(options.body).clientMutationId).toBe('cart-fixed');
        expect(createIdempotencyKey).toHaveBeenCalledWith('cart');
    });

    it('coerces a non-array commands value to an empty list', async () => {
        await cartApi.applyCommands({ commands: 'nope' });
        expect(JSON.parse(lastCall()[1].body).commands).toEqual([]);
    });

    it('normalizes the cart snapshot attached to a 409 conflict before rethrowing', async () => {
        const conflict = Object.assign(new Error('conflict'), {
            status: 409,
            data: { cart: { items: [{ id: 'x' }], revision: 5 } },
        });
        apiFetch.mockRejectedValue(conflict);

        await expect(cartApi.applyCommands({})).rejects.toBe(conflict);
        expect(conflict.data.cart).toMatchObject({ items: [{ id: 'x' }], version: 5 });
    });

    it('normalizes bare conflict data without a nested cart', async () => {
        const conflict = Object.assign(new Error('conflict'), {
            status: 409,
            data: { items: [{ id: 'y' }], version: 7 },
        });
        apiFetch.mockRejectedValue(conflict);

        await expect(cartApi.applyCommands({})).rejects.toBe(conflict);
        expect(conflict.data).toMatchObject({ items: [{ id: 'y' }], version: 7 });
        expect(conflict.data.summary).toBeNull();
    });

    it('passes non-409 errors through untouched', async () => {
        const serverError = Object.assign(new Error('boom'), { status: 500, data: { raw: true } });
        apiFetch.mockRejectedValue(serverError);

        await expect(cartApi.applyCommands({})).rejects.toBe(serverError);
        expect(serverError.data).toEqual({ raw: true });
    });
});
