import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    getActiveMarketHeaders,
    getActiveMarketState,
    resetActiveMarketHeaders,
    setActiveMarketHeaders,
} from './marketRuntime';

describe('marketRuntime active market headers', () => {
    beforeEach(() => {
        resetActiveMarketHeaders();
    });

    afterEach(() => {
        resetActiveMarketHeaders();
    });

    it('defaults to the IN / INR / en market', () => {
        expect(getActiveMarketState()).toEqual({ country: 'IN', currency: 'INR', language: 'en' });
        expect(getActiveMarketHeaders()).toEqual({
            'x-market-country': 'IN',
            'x-market-currency': 'INR',
            'x-market-language': 'en',
        });
    });

    it('normalizes country, currency, and language casing', () => {
        setActiveMarketHeaders({ country: 'us', currency: 'usd', language: 'EN' });
        expect(getActiveMarketState()).toEqual({ country: 'US', currency: 'USD', language: 'en' });
    });

    it('truncates values to header-safe lengths', () => {
        setActiveMarketHeaders({ country: 'USAX', currency: 'USDX', language: 'en-us-x' });
        expect(getActiveMarketState()).toEqual({ country: 'US', currency: 'USD', language: 'en-us' });
    });

    it('accepts countryCode as an alias for country', () => {
        setActiveMarketHeaders({ countryCode: 'de', currency: 'eur', language: 'de' });
        expect(getActiveMarketState()).toEqual({ country: 'DE', currency: 'EUR', language: 'de' });
    });

    it('falls back to defaults for empty or missing values', () => {
        setActiveMarketHeaders({ country: '', currency: null });
        expect(getActiveMarketState()).toEqual({ country: 'IN', currency: 'INR', language: 'en' });
        setActiveMarketHeaders();
        expect(getActiveMarketHeaders()['x-market-country']).toBe('IN');
    });

    it('returns a copy of the active state so callers cannot mutate it', () => {
        const snapshot = getActiveMarketState();
        snapshot.country = 'ZZ';
        expect(getActiveMarketState().country).toBe('IN');
    });

    it('resetActiveMarketHeaders restores the default market', () => {
        setActiveMarketHeaders({ country: 'jp', currency: 'jpy', language: 'ja' });
        resetActiveMarketHeaders();
        expect(getActiveMarketState()).toEqual({ country: 'IN', currency: 'INR', language: 'en' });
    });
});
