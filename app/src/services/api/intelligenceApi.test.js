import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../apiBase', () => ({
    apiFetch: vi.fn(async () => ({ data: {} })),
}));
vi.mock('./apiUtils', () => ({
    getAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer user' })),
}));

import { apiFetch } from '../apiBase';
import { intelligenceApi, priceAlertApi } from './intelligenceApi';

const lastCall = () => apiFetch.mock.calls[apiFetch.mock.calls.length - 1];

beforeEach(() => {
    apiFetch.mockClear();
    apiFetch.mockImplementation(async () => ({ data: {} }));
});

describe('intelligenceApi', () => {
    it('optimizeRewards POSTs without a body', async () => {
        apiFetch.mockResolvedValue({ data: { improved: true } });
        const result = await intelligenceApi.optimizeRewards();

        const [path, options] = lastCall();
        expect(path).toBe('/intelligence/optimize-rewards');
        expect(options.method).toBe('POST');
        expect(options.headers.Authorization).toBe('Bearer user');
        expect(options.body).toBeUndefined();
        expect(result).toEqual({ improved: true });
    });

    it('getLatestRewards GETs the latest rewards', async () => {
        apiFetch.mockResolvedValue({ data: { rewards: [] } });
        const result = await intelligenceApi.getLatestRewards();

        const [path, options] = lastCall();
        expect(path).toBe('/intelligence/latest-rewards');
        expect(options.method).toBeUndefined();
        expect(options.headers.Authorization).toBe('Bearer user');
        expect(result).toEqual({ rewards: [] });
    });
});

describe('priceAlertApi', () => {
    it('create POSTs the productId and targetPrice', async () => {
        await priceAlertApi.create('p1', 499.5);
        const [path, options] = lastCall();
        expect(path).toBe('/price-alerts');
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({ productId: 'p1', targetPrice: 499.5 });
    });

    it('getMyAlerts GETs the current user alerts', async () => {
        await priceAlertApi.getMyAlerts();
        const [path, options] = lastCall();
        expect(path).toBe('/price-alerts/my');
        expect(options.method).toBeUndefined();
        expect(options.headers.Authorization).toBe('Bearer user');
    });

    it('delete issues DELETE for the alert id', async () => {
        await priceAlertApi.delete('42');
        const [path, options] = lastCall();
        expect(path).toBe('/price-alerts/42');
        expect(options.method).toBe('DELETE');
    });

    it('getHistory GETs the price history for a product', async () => {
        await priceAlertApi.getHistory('p9');
        const [path] = lastCall();
        expect(path).toBe('/price-alerts/history/p9');
    });
});
