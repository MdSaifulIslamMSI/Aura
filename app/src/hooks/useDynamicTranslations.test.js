import { beforeEach, describe, expect, it, vi } from 'vitest';

const { translateTextsMock } = vi.hoisted(() => ({
    translateTextsMock: vi.fn(async ({ texts = [], language }) => Object.fromEntries(
        texts.map((text) => [text, `${language}:${text}`])
    )),
}));

let collectDynamicTranslationTexts;
let shouldTranslateDynamicText;
let translateDynamicTextBatch;

describe('useDynamicTranslations helpers', () => {
    beforeEach(async () => {
        translateTextsMock.mockClear();
        vi.resetModules();
        vi.doMock('@/services/api', () => ({
            i18nApi: {
                translateTexts: translateTextsMock,
            },
        }));

        ({
            collectDynamicTranslationTexts,
            shouldTranslateDynamicText,
            translateDynamicTextBatch,
        } = await import('./useDynamicTranslations'));
    });

    it('filters obviously non-translatable values', () => {
        expect(shouldTranslateDynamicText('A real sentence')).toBe(true);
        expect(shouldTranslateDynamicText('support ticket')).toBe(true);
        expect(shouldTranslateDynamicText('support_ticket')).toBe(false);
        expect(shouldTranslateDynamicText('https://aura.example/product')).toBe(false);
        expect(shouldTranslateDynamicText('/admin/orders')).toBe(false);
        expect(shouldTranslateDynamicText('ops@example.com')).toBe(false);
        expect(shouldTranslateDynamicText('  404  ')).toBe(false);
        expect(shouldTranslateDynamicText('GET /api/orders')).toBe(false);
        expect(shouldTranslateDynamicText('AORUS-15X')).toBe(false);
        expect(shouldTranslateDynamicText('RTX 4090')).toBe(false);
        expect(shouldTranslateDynamicText('SKU-AB12-9900')).toBe(false);
        expect(shouldTranslateDynamicText('Summer Dress Cairo Luxe Collection')).toBe(true);
    });

    it('normalizes and caches translated batches', async () => {
        const first = await translateDynamicTextBatch({
            texts: ['  Hello world  ', 'Hello   world', 'https://skip.me'],
            language: 'zz-cache-test',
        });

        expect(first).toEqual({
            'Hello world': 'zz-cache-test:Hello world',
        });
        expect(collectDynamicTranslationTexts(['  Hello world  ', 'Hello   world'])).toEqual(['Hello world']);
        expect(translateTextsMock).toHaveBeenCalledTimes(1);

        const second = await translateDynamicTextBatch({
            texts: ['Hello world'],
            language: 'zz-cache-test',
        });

        expect(second).toEqual({
            'Hello world': 'zz-cache-test:Hello world',
        });
        expect(translateTextsMock).toHaveBeenCalledTimes(1);
    });
});
