import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNativeMobilePlatform, isCapacitorNativeRuntime } from './nativeRuntime';

describe('nativeRuntime', () => {
    afterEach(() => {
        delete window.Capacitor;
        vi.restoreAllMocks();
    });

    it('reports no platform and no native runtime without a Capacitor bridge', () => {
        expect(getNativeMobilePlatform()).toBe('');
        expect(isCapacitorNativeRuntime()).toBe(false);
    });

    it('ignores non-object bridge values', () => {
        window.Capacitor = 'capacitor';
        expect(getNativeMobilePlatform()).toBe('');
        expect(isCapacitorNativeRuntime()).toBe(false);
    });

    it('returns lowercase mobile platforms reported by getPlatform()', () => {
        window.Capacitor = { getPlatform: () => 'Android' };
        expect(getNativeMobilePlatform()).toBe('android');

        window.Capacitor = { getPlatform: () => 'iOS' };
        expect(getNativeMobilePlatform()).toBe('ios');
    });

    it('ignores non-mobile platforms like web', () => {
        window.Capacitor = { getPlatform: () => 'web' };
        expect(getNativeMobilePlatform()).toBe('');
        expect(isCapacitorNativeRuntime()).toBe(false);
    });

    it('prefers isNativePlatform() when the bridge exposes it', () => {
        window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'web' };
        expect(isCapacitorNativeRuntime()).toBe(true);

        window.Capacitor = { isNativePlatform: () => false, getPlatform: () => 'android' };
        expect(isCapacitorNativeRuntime()).toBe(false);
    });

    it('falls back to getPlatform() when isNativePlatform() is absent', () => {
        window.Capacitor = { getPlatform: () => 'android' };
        expect(isCapacitorNativeRuntime()).toBe(true);
    });

    it('recovers when bridge methods throw', () => {
        window.Capacitor = {
            getPlatform: () => {
                throw new Error('bridge exploded');
            },
        };
        expect(getNativeMobilePlatform()).toBe('');
        expect(isCapacitorNativeRuntime()).toBe(false);

        window.Capacitor = {
            isNativePlatform: () => {
                throw new Error('bridge exploded');
            },
            getPlatform: () => 'ios',
        };
        expect(isCapacitorNativeRuntime()).toBe(true);
    });
});
