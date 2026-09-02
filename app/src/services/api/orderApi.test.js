import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../apiBase', () => ({
    apiFetch: vi.fn(),
}));

vi.mock('./apiUtils', () => ({
    getAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer token-1' })),
    createIdempotencyKey: vi.fn((scope) => `idem-${scope || 'order'}-123`),
}));

import { apiFetch } from '../apiBase';
import { orderApi } from './orderApi';

const lastCall = () => apiFetch.mock.calls[apiFetch.mock.calls.length - 1];

beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ data: { ok: true } });
});

describe('orderApi', () => {
    it('quotes an order via POST /orders/quote', async () => {
        await orderApi.quoteOrder({ items: [] });
        const [path, options] = lastCall();
        expect(path).toBe('/orders/quote');
        expect(options.method).toBe('POST');
        expect(options.body).toBe(JSON.stringify({ items: [] }));
    });

    it('creates orders with the caller-supplied idempotency key', async () => {
        await orderApi.createOrder({ items: [], idempotencyKey: 'client-key-1' });
        const [path, options] = lastCall();
        expect(path).toBe('/orders');
        expect(options.headers['Idempotency-Key']).toBe('client-key-1');
    });

    it('generates an idempotency key when the payload omits one', async () => {
        await orderApi.createOrder({ items: [] });
        const [, options] = lastCall();
        expect(options.headers['Idempotency-Key']).toBe('idem-order-123');
    });

    it('lists my orders with the default page size and skips blank params', async () => {
        await orderApi.getMyOrders({ status: 'delivered', page: '' });
        const [path] = lastCall();
        expect(path).toBe('/orders/myorders?limit=20&status=delivered');
    });

    it('builds admin order list queries the same way', async () => {
        await orderApi.getAllOrders({ limit: 50 });
        const [path] = lastCall();
        expect(path).toBe('/orders?limit=50');
    });

    it('fetches the order timeline and receipt by id', async () => {
        await orderApi.getOrderTimeline('o1');
        expect(lastCall()[0]).toBe('/orders/o1/timeline');

        await orderApi.getReceipt('o1');
        expect(lastCall()[0]).toBe('/orders/o1/receipt');
    });

    it('requests refunds and replacements through the command center', async () => {
        await orderApi.requestRefund('o1', { reason: 'damaged' });
        const [refundPath, refundOptions] = lastCall();
        expect(refundPath).toBe('/orders/o1/command-center/refund');
        expect(refundOptions.method).toBe('POST');
        expect(refundOptions.body).toBe(JSON.stringify({ reason: 'damaged' }));

        await orderApi.requestReplacement('o1', { reason: 'wrong size' });
        expect(lastCall()[0]).toBe('/orders/o1/command-center/replace');
    });

    it('processes admin refund decisions with PATCH and the request id', async () => {
        await orderApi.processRefundRequestAdmin('o1', 'rr-9', { approve: true });
        const [path, options] = lastCall();
        expect(path).toBe('/orders/o1/command-center/refund/rr-9/admin');
        expect(options.method).toBe('PATCH');
        expect(options.headers.Authorization).toBe('Bearer token-1');
    });

    it('stamps buy-again calls with a scoped idempotency key', async () => {
        await orderApi.buyAgain('o1');
        const [path, options] = lastCall();
        expect(path).toBe('/orders/o1/buy-again');
        expect(options.headers['Idempotency-Key']).toBe('idem-buy-again-o1-123');
    });

    it('returns the unwrapped data payload from apiFetch', async () => {
        const data = await orderApi.getCommandCenter('o2');
        expect(data).toEqual({ ok: true });
        expect(lastCall()[0]).toBe('/orders/o2/command-center');
    });
});