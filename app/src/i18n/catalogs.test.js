import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalogs, isFormatJsEnabled, loadCatalog, resolveFormatJsLanguage } from './catalogs';

describe('catalogs', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('synchronously exposes the compiled English catalog', () => {
        expect(catalogs.en).toBeTypeOf('object');
        expect(Object.keys(catalogs.en).length).toBeGreaterThan(100);
        expect(catalogs.en['accessibility.hidePassword']).toBe('Hide password');
    });

    it('resolves "en" without dynamic import and caches it in catalogs', async () => {
        await expect(loadCatalog('en')).resolves.toBe(catalogs.en);
    });

    it('falls back to English for unknown languages', async () => {
        await expect(loadCatalog('xx-YY')).resolves.toBe(catalogs.en);
        await expect(loadCatalog(undefined)).resolves.toBe(catalogs.en);
    });

    it('lazy-loads another locale and memoizes the promise', async () => {
        const first = await loadCatalog('hi');
        expect(first).toBeTypeOf('object');
        expect(first['accessibility.hidePassword']).toBeTypeOf('string');
        expect(catalogs.hi).toBe(first);
        await expect(loadCatalog('hi')).resolves.toBe(first);
    });
});

describe('isFormatJsEnabled', () => {
    it('defaults to disabled when the flag is unset', () => {
        expect(isFormatJsEnabled()).toBe(false);
    });

    it('parses truthy and falsy env values', () => {
        vi.stubEnv('VITE_I18N_FORMATJS_ENABLED', 'true');
        expect(isFormatJsEnabled()).toBe(true);

        vi.stubEnv('VITE_I18N_FORMATJS_ENABLED', 'YES');
        expect(isFormatJsEnabled()).toBe(true);

        vi.stubEnv('VITE_I18N_FORMATJS_ENABLED', '0');
        expect(isFormatJsEnabled()).toBe(false);

        vi.stubEnv('VITE_I18N_FORMATJS_ENABLED', 'off');
        expect(isFormatJsEnabled()).toBe(false);
    });
});

describe('resolveFormatJsLanguage', () => {
    it('locks to English while FormatJS is disabled', () => {
        expect(resolveFormatJsLanguage('hi')).toBe('en');
        expect(resolveFormatJsLanguage('en-XA')).toBe('en');
    });

    it('honors known languages once FormatJS is enabled', () => {
        vi.stubEnv('VITE_I18N_FORMATJS_ENABLED', 'true');
        expect(resolveFormatJsLanguage('hi')).toBe('hi');
        expect(resolveFormatJsLanguage('en')).toBe('en');
        expect(resolveFormatJsLanguage('not-a-locale')).toBe('en');
    });
});
