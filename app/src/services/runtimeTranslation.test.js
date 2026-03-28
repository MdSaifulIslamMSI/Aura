import { beforeEach, describe, expect, it, vi } from 'vitest';

const { translateTextsMock } = vi.hoisted(() => ({
    translateTextsMock: vi.fn(async ({ texts = [], language }) => Object.fromEntries(
        texts.map((text) => [text, `${language}:${text}`])
    )),
}));

const loadRuntimeTranslationModule = async () => {
    vi.resetModules();
    vi.doMock('@/services/api/i18nApi', () => ({
        i18nApi: {
            translateTexts: translateTextsMock,
        },
    }));

    return import('./runtimeTranslation');
};

describe('runtimeTranslation service', () => {
    beforeEach(() => {
        window.localStorage.clear();
        translateTextsMock.mockClear();
    });

    it('persists shared runtime translations and rehydrates them on reload', async () => {
        let runtimeTranslation = await loadRuntimeTranslationModule();

        const first = await runtimeTranslation.requestRuntimeTranslations({
            texts: ['Hello world'],
            language: 'zz-shared-cache',
        });

        expect(first).toEqual({
            'Hello world': 'zz-shared-cache:Hello world',
        });
        expect(translateTextsMock).toHaveBeenCalledTimes(1);
        expect(window.localStorage.getItem('aura_runtime_translation_cache_v2')).toContain('zz-shared-cache');

        runtimeTranslation = await loadRuntimeTranslationModule();
        translateTextsMock.mockClear();

        const hydrated = runtimeTranslation.getCachedRuntimeTranslation({
            language: 'zz-shared-cache',
            text: 'Hello world',
        });

        expect(hydrated).toBe('zz-shared-cache:Hello world');
        expect(translateTextsMock).not.toHaveBeenCalled();
    });

    it('hydrates legacy runtime translation stores into the shared cache', async () => {
        window.localStorage.setItem('aura_dynamic_translation_cache_v1', JSON.stringify({
            es: {
                'Ready for translation': 'es:Ready for translation',
            },
        }));

        const runtimeTranslation = await loadRuntimeTranslationModule();

        const hydrated = runtimeTranslation.getCachedRuntimeTranslation({
            language: 'es',
            text: 'Ready for translation',
        });

        expect(hydrated).toBe('es:Ready for translation');
        expect(translateTextsMock).not.toHaveBeenCalled();
    });
});
