import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../apiBase', () => ({
    apiFetch: vi.fn(async () => ({ data: {} })),
}));
vi.mock('./apiUtils', () => ({
    getAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer seller' })),
    createIdempotencyKey: vi.fn((prefix) => `${prefix}-fixed`),
    runWhenIdle: vi.fn((callback) => { callback(); }),
}));

import { apiFetch } from '../apiBase';
import { createIdempotencyKey, runWhenIdle } from './apiUtils';
import { listingApi, tradeInApi } from './listingApi';

const lastCall = () => apiFetch.mock.calls[apiFetch.mock.calls.length - 1];

beforeEach(() => {
    apiFetch.mockClear();
    createIdempotencyKey.mockClear();
    runWhenIdle.mockClear();
    apiFetch.mockImplementation(async () => ({ data: {} }));
});

describe('listingApi CRUD', () => {
    it('getListings forwards query params with auth headers', async () => {
        await listingApi.getListings({ q: 'phone', page: 2 });
        const [path, options] = lastCall();
        expect(path).toBe('/listings');
        expect(options.params).toEqual({ q: 'phone', page: 2 });
        expect(options.headers.Authorization).toBe('Bearer seller');
    });

    it('createListing POSTs the payload, updateListing PUTs it', async () => {
        await listingApi.createListing({ title: 'Phone', price: 100 });
        let [path, options] = lastCall();
        expect(path).toBe('/listings');
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({ title: 'Phone', price: 100 });

        await listingApi.updateListing('7', { price: 90 });
        [path, options] = lastCall();
        expect(path).toBe('/listings/7');
        expect(options.method).toBe('PUT');
        expect(JSON.parse(options.body)).toEqual({ price: 90 });
    });

    it('deleteListing issues DELETE without a body', async () => {
        await listingApi.deleteListing('7');
        const [path, options] = lastCall();
        expect(path).toBe('/listings/7');
        expect(options.method).toBe('DELETE');
        expect(options.body).toBeUndefined();
    });

    it('markSold PATCHes the sold flag endpoint', async () => {
        await listingApi.markSold('3');
        const [path, options] = lastCall();
        expect(path).toBe('/listings/3/sold');
        expect(options.method).toBe('PATCH');
    });

    it('getSellerProfile fetches seller info by user id', async () => {
        await listingApi.getSellerProfile('u77');
        expect(lastCall()[0]).toBe('/listings/seller/u77');
    });
});

describe('listingApi.getHotspots', () => {
    it('returns the primary endpoint data on success', async () => {
        apiFetch.mockResolvedValue({ data: [{ id: 'h1' }] });
        await expect(listingApi.getHotspots({ listingId: '1' })).resolves.toEqual([{ id: 'h1' }]);
        expect(lastCall()[0]).toBe('/listings/hotspots');
    });

    it('retries the /hotspots candidate path on a 404', async () => {
        const notFound = Object.assign(new Error('missing'), { status: 404 });
        apiFetch
            .mockRejectedValueOnce(notFound)
            .mockResolvedValueOnce({ data: [{ id: 'h2' }] });

        await expect(listingApi.getHotspots()).resolves.toEqual([{ id: 'h2' }]);
        expect(lastCall()[0]).toBe('/hotspots');
    });

    it('rethrows non-404 failures without retrying', async () => {
        const serverError = Object.assign(new Error('boom'), { status: 500 });
        apiFetch.mockRejectedValue(serverError);

        await expect(listingApi.getHotspots()).rejects.toBe(serverError);
        expect(apiFetch).toHaveBeenCalledTimes(1);
    });
});

describe('listingApi.prefetchListingById', () => {
    it('fetches the listing during idle time and swallows failures', async () => {
        apiFetch.mockRejectedValue(new Error('offline'));
        listingApi.prefetchListingById('prefetch-1');

        expect(runWhenIdle).toHaveBeenCalledTimes(1);
        expect(lastCall()[0]).toBe('/listings/prefetch-1');
    });

    it('never fetches the same listing id twice', () => {
        listingApi.prefetchListingById('prefetch-dedupe');
        listingApi.prefetchListingById('prefetch-dedupe');
        expect(apiFetch).toHaveBeenCalledTimes(1);
    });

    it('ignores blank or missing ids', () => {
        listingApi.prefetchListingById('   ');
        listingApi.prefetchListingById(null);
        expect(apiFetch).not.toHaveBeenCalled();
    });
});


describe('listingApi escrow intents', () => {
    it('createEscrowIntent attaches a generated idempotency key', async () => {
        await listingApi.createEscrowIntent('9', { amount: 10 });
        const [path, options] = lastCall();
        expect(path).toBe('/listings/9/escrow/intents');
        expect(options.method).toBe('POST');
        expect(options.headers['Idempotency-Key']).toBe('escrow-intent-fixed');
        expect(createIdempotencyKey).toHaveBeenCalledWith('escrow-intent');
    });

    it('createEscrowIntent honors a caller-provided idempotency key', async () => {
        await listingApi.createEscrowIntent('9', { idempotencyKey: 'caller-key' });
        expect(lastCall()[1].headers['Idempotency-Key']).toBe('caller-key');
    });

    it('confirmEscrowIntent POSTs to the intent confirm route', async () => {
        await listingApi.confirmEscrowIntent('9', 'i1', {});
        const [path, options] = lastCall();
        expect(path).toBe('/listings/9/escrow/intents/i1/confirm');
        expect(options.method).toBe('POST');
        expect(options.headers['Idempotency-Key']).toBe('escrow-confirm-fixed');
    });

    it('startEscrow, confirmEscrow, and cancelEscrow PATCH the escrow routes', async () => {
        await listingApi.startEscrow('4', { amount: 1 });
        expect(lastCall()[0]).toBe('/listings/4/escrow/start');
        await listingApi.confirmEscrow('4');
        expect(lastCall()[0]).toBe('/listings/4/escrow/confirm');
        await listingApi.cancelEscrow('4');
        expect(lastCall()[0]).toBe('/listings/4/escrow/cancel');
        expect(lastCall()[1].method).toBe('PATCH');
    });
});

describe('tradeInApi', () => {
    it('estimate POSTs to the estimate endpoint', async () => {
        await tradeInApi.estimate({ model: 'A1', condition: 'good' });
        const [path, options] = lastCall();
        expect(path).toBe('/trade-in/estimate');
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({ model: 'A1', condition: 'good' });
    });

    it('getMyTradeIns GETs the user trade-ins', async () => {
        apiFetch.mockResolvedValue({ data: { items: [] } });
        await expect(tradeInApi.getMyTradeIns()).resolves.toEqual({ items: [] });
        expect(lastCall()[0]).toBe('/trade-in/my');
    });

    it('cancel DELETEs the trade-in by id', async () => {
        await tradeInApi.cancel('15');
        const [path, options] = lastCall();
        expect(path).toBe('/trade-in/15');
        expect(options.method).toBe('DELETE');
    });
});
