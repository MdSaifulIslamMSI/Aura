import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../apiBase', () => ({
    apiFetch: vi.fn(async () => ({ data: {} })),
}));
vi.mock('./apiUtils', () => ({
    getAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer admin' })),
}));

import { apiFetch } from '../apiBase';
import { emergencyApi } from './emergencyApi';

const lastCall = () => apiFetch.mock.calls[apiFetch.mock.calls.length - 1];

beforeEach(() => {
    apiFetch.mockClear();
    apiFetch.mockImplementation(async () => ({ data: {} }));
});

describe('emergencyApi', () => {
    it('getStatus skips cache, bounds the timeout, and needs no auth header', async () => {
        apiFetch.mockResolvedValue({ data: { active: false } });
        const status = await emergencyApi.getStatus();

        const [path, options] = lastCall();
        expect(path).toBe('/emergency/status');
        expect(options.method).toBeUndefined();
        expect(options.cache).toBe('no-store');
        expect(options.timeoutMs).toBe(8000);
        expect(options.headers).toBeUndefined();
        expect(status).toEqual({ active: false });
    });

    it('listAdminControls and listAudit send auth headers with no-store caching', async () => {
        await emergencyApi.listAdminControls();
        let [path, options] = lastCall();
        expect(path).toBe('/admin/emergency-controls');
        expect(options.headers.Authorization).toBe('Bearer admin');
        expect(options.cache).toBe('no-store');

        await emergencyApi.listAudit({ limit: 5 });
        [path, options] = lastCall();
        expect(path).toBe('/admin/emergency-controls/audit');
        expect(options.params).toEqual({ limit: 5 });
        expect(options.cache).toBe('no-store');
    });

    it('activate, deactivate, and extend POST their JSON payloads', async () => {
        await emergencyApi.activate('checkout', { reason: 'fraud' });
        let [path, options] = lastCall();
        expect(path).toBe('/admin/emergency-controls/checkout/activate');
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({ reason: 'fraud' });

        await emergencyApi.deactivate('checkout', { note: 'ok' });
        [path, options] = lastCall();
        expect(path).toBe('/admin/emergency-controls/checkout/deactivate');
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({ note: 'ok' });

        await emergencyApi.extend('checkout', { minutes: 30 });
        [path, options] = lastCall();
        expect(path).toBe('/admin/emergency-controls/checkout/extend');
        expect(options.method).toBe('POST');
        expect(JSON.parse(options.body)).toEqual({ minutes: 30 });
    });

    it('updateMessage PATCHes the control message', async () => {
        await emergencyApi.updateMessage('checkout', { message: 'Down for maintenance' });
        const [path, options] = lastCall();
        expect(path).toBe('/admin/emergency-controls/checkout/message');
        expect(options.method).toBe('PATCH');
        expect(JSON.parse(options.body)).toEqual({ message: 'Down for maintenance' });
    });

    it('propagates API failures to the caller', async () => {
        const failure = Object.assign(new Error('locked'), { status: 423 });
        apiFetch.mockRejectedValue(failure);
        await expect(emergencyApi.getStatus()).rejects.toBe(failure);
    });
});
