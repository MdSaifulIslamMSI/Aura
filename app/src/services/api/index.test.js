import { describe, expect, it } from 'vitest';
import * as api from './index';

const requiredApiClients = [
    'catalogApi',
    'recommendationApi',
    'cartApi',
    'userApi',
    'authApi',
    'orderApi',
    'paymentApi',
    'listingApi',
    'tradeInApi',
    'intelligenceApi',
    'priceAlertApi',
    'adminApi',
    'trustApi',
    'uploadApi',
    'supportApi',
    'notificationApi',
    'marketApi',
    'emergencyApi',
];

const requiredHelpers = [
    'normalizeCartSnapshot',
    'getAuthHeader',
    'createIdempotencyKey',
    'runWhenIdle',
    'parseApiError',
];

describe('services/api barrel', () => {
    it('re-exports every API client from its module', () => {
        for (const name of requiredApiClients) {
            expect(api, `expected export: ${name}`).toHaveProperty(name);
            expect(typeof api[name], `${name} should be an object of API calls`).toBe('object');
            expect(api[name]).not.toBeNull();
        }
    });

    it('re-exports shared helpers from apiUtils', () => {
        for (const name of requiredHelpers) {
            expect(typeof api[name], `${name} should be callable`).toBe('function');
        }
    });

    it('exposes distinct client objects per domain', () => {
        const clients = requiredApiClients.map((name) => api[name]);
        expect(new Set(clients).size).toBe(clients.length);
    });

    it('keeps the cart domain contract reachable through the barrel', () => {
        expect(typeof api.cartApi.getCart).toBe('function');
        expect(typeof api.cartApi.applyCommands).toBe('function');
        expect(typeof api.normalizeCartSnapshot).toBe('function');
    });
});
