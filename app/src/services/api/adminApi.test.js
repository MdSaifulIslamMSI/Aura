import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../apiBase', () => ({
    apiFetch: vi.fn(async () => ({ data: {} })),
    buildServiceUrl: vi.fn((path) => `http://test.local${path}`),
}));
vi.mock('./apiUtils', () => ({
    getAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer admin' })),
    createIdempotencyKey: vi.fn((prefix) => `${prefix}-fixed`),
}));

import { apiFetch, buildServiceUrl } from '../apiBase';
import { createIdempotencyKey } from './apiUtils';
import { adminApi } from './adminApi';

const lastCall = () => apiFetch.mock.calls[apiFetch.mock.calls.length - 1];

beforeEach(() => {
    apiFetch.mockClear();
    createIdempotencyKey.mockClear();
    apiFetch.mockImplementation(async () => ({ data: {} }));
});

describe('adminApi user management', () => {
    it('getAnalyticsOverview and listUsers forward params with auth headers', async () => {
        await adminApi.getAnalyticsOverview({ range: '7d' });
        let [path, options] = lastCall();
        expect(path).toBe('/admin/analytics/overview');
        expect(options.params).toEqual({ range: '7d' });
        expect(options.headers.Authorization).toBe('Bearer admin');

        await adminApi.listUsers({ page: 1 });
        [path, options] = lastCall();
        expect(path).toBe('/admin/users');
        expect(options.params).toEqual({ page: 1 });
    });

    it('getUserDetails targets the user detail route', async () => {
        await adminApi.getUserDetails('u1');
        expect(lastCall()[0]).toBe('/admin/users/u1');
    });

    it('warnUser and suspendUser POST their JSON payloads', async () => {
        await adminApi.warnUser('u1', { reason: 'spam' });
        let [path, options] = lastCall();
        expect(path).toBe('/admin/users/u1/warn');
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({ reason: 'spam' });

        await adminApi.suspendUser('u1', { days: 7 });
        [path, options] = lastCall();
        expect(path).toBe('/admin/users/u1/suspend');
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({ days: 7 });
    });

    it('dismissWarning alias and dismissUserWarning hit the dismiss-warning route', async () => {
        await adminApi.dismissWarning('u2');
        expect(lastCall()[0]).toBe('/admin/users/u2/dismiss-warning');
        await adminApi.dismissUserWarning('u3');
        expect(lastCall()[0]).toBe('/admin/users/u3/dismiss-warning');
        expect(lastCall()[1].method).toBe('POST');
    });

    it('deleteUser POSTs the delete route with its payload', async () => {
        await adminApi.deleteUser('u4', { purge: true });
        const [path, options] = lastCall();
        expect(path).toBe('/admin/users/u4/delete');
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({ purge: true });
    });
});

describe('adminApi notifications and email ops', () => {
    it('notification summary and read routes use the right verbs', async () => {
        await adminApi.getNotificationSummary();
        expect(lastCall()[0]).toBe('/admin/notifications/summary');

        await adminApi.markNotificationRead('n1', false);
        const [path, options] = lastCall();
        expect(path).toBe('/admin/notifications/n1/read');
        expect(options.method).toBe('PATCH');
        expect(JSON.parse(options.body)).toEqual({ read: false });
    });

    it('retryEmailQueueItem attaches the generated idempotency key', async () => {
        await adminApi.retryEmailQueueItem('q1', { note: 'retry' });
        const [path, options] = lastCall();
        expect(path).toBe('/admin/email-ops/order-queue/q1/retry');
        expect(options.method).toBe('POST');
        expect(options.headers['Idempotency-Key']).toBe('email-queue-retry-fixed');
        expect(JSON.parse(options.body)).toEqual({ note: 'retry' });
    });

    it('sendEmailOpsTest honors a caller-provided idempotency key', async () => {
        await adminApi.sendEmailOpsTest({ idempotencyKey: 'mine' });
        const [, options] = lastCall();
        expect(options.headers['Idempotency-Key']).toBe('mine');
        expect(createIdempotencyKey).not.toHaveBeenCalled();
    });
});

describe('adminApi product management', () => {
    it('encodes product ids and appends a cache-busting timestamp', async () => {
        await adminApi.getProductById('a/b');
        const [path] = lastCall();
        expect(path).toMatch(/^\/admin\/products\/a%2Fb\?_t=\d+$/);
    });

    it('createProduct POSTs while core and pricing updates PATCH sub-resources', async () => {
        await adminApi.createProduct({ title: 'x' });
        expect(lastCall()[1].method).toBe('POST');

        await adminApi.updateProductCore('p1', { title: 'y' });
        let [path, options] = lastCall();
        expect(path).toBe('/admin/products/p1/core');
        expect(options.method).toBe('PATCH');
        expect(JSON.parse(options.body)).toEqual({ title: 'y' });

        await adminApi.updateProductPricing('p1', { price: 5 });
        [path] = lastCall();
        expect(path).toBe('/admin/products/p1/pricing');
    });

    it('deleteProduct issues DELETE with a JSON body', async () => {
        await adminApi.deleteProduct('p1', { hard: false });
        const [path, options] = lastCall();
        expect(path).toBe('/admin/products/p1');
        expect(options.method).toBe('DELETE');
        expect(JSON.parse(options.body)).toEqual({ hard: false });
    });
});

describe('adminApi payments', () => {
    it('captureAdminPayment mints a capture idempotency key by default', async () => {
        await adminApi.captureAdminPayment('pi_1', {});
        const [path, options] = lastCall();
        expect(path).toBe('/admin/payments/pi_1/capture');
        expect(options.method).toBe('POST');
        expect(options.headers['Idempotency-Key']).toBe('capture-fixed');
    });

    it('retryAdminCapture reuses caller keys and targets retry-capture', async () => {
        await adminApi.retryAdminCapture('pi_1', { idempotencyKey: 'mine' });
        const [path, options] = lastCall();
        expect(path).toBe('/admin/payments/pi_1/retry-capture');
        expect(options.headers['Idempotency-Key']).toBe('mine');
    });

    it('getRefundLedger forwards params', async () => {
        await adminApi.getRefundLedger({ from: '2026-01-01' });
        const [path, options] = lastCall();
        expect(path).toBe('/admin/payments/refunds/ledger');
        expect(options.params).toEqual({ from: '2026-01-01' });
    });
});

describe('adminApi.getSystemHealth', () => {
    it('fetches the service health endpoint and returns its JSON', async () => {
        const jsonResponse = {
            ok: true,
            json: async () => ({ status: 'healthy' }),
        };
        const fetchMock = vi.fn(async () => jsonResponse);
        vi.stubGlobal('fetch', fetchMock);

        await expect(adminApi.getSystemHealth()).resolves.toEqual({ status: 'healthy' });
        expect(buildServiceUrl).toHaveBeenCalledWith('/health');
        expect(fetchMock.mock.calls[0][0]).toBe('http://test.local/health');

        vi.unstubAllGlobals();
    });

    it('reports a down status when the health fetch fails', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
        await expect(adminApi.getSystemHealth()).resolves.toEqual({ status: 'down' });
        vi.unstubAllGlobals();
    });
});

describe('adminApi.exportAnalyticsCsv', () => {
    it('unwraps the blob, filename, and row count from the export response', async () => {
        apiFetch.mockResolvedValue({
            response: {
                blob: async () => 'CSV-BLOB',
                headers: {
                    get: (name) => ({
                        'content-disposition': 'attachment; filename="export.csv"',
                        'x-admin-export-row-count': '42',
                    }[name] || ''),
                },
            },
        });

        const result = await adminApi.exportAnalyticsCsv({ range: '30d' });
        expect(result).toEqual({ blob: 'CSV-BLOB', filename: 'export.csv', rowCount: 42 });
        const [path, options] = lastCall();
        expect(path).toBe('/admin/analytics/export');
        expect(options.throwOnHttpError).toBe(true);
    });

    it('falls back to a timestamped filename when none is provided', async () => {
        apiFetch.mockResolvedValue({
            response: {
                blob: async () => 'CSV-BLOB',
                headers: { get: () => '' },
            },
        });

        const result = await adminApi.exportAnalyticsCsv();
        expect(result.blob).toBe('CSV-BLOB');
        expect(result.filename).toMatch(/^admin_export_\d+\.csv$/);
        expect(result.rowCount).toBe(0);
    });
});
