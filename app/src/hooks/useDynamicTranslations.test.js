import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { translateTextsMock } = vi.hoisted(() => ({
    translateTextsMock: vi.fn(async ({ texts = [], language }) => Object.fromEntries(
        texts.map((text) => [text, `${language}:${text}`])
    )),
}));

let collectDynamicTranslationTexts;
let shouldTranslateDynamicText;
let translateDynamicTextBatch;
let useDynamicTranslations;

const loadHookModule = async () => {
    vi.resetModules();
    vi.doMock('@/services/api/i18nApi', () => ({
        i18nApi: {
            translateTexts: translateTextsMock,
        },
    }));
    vi.doMock('@/context/MarketContext', () => ({
        useMarket: () => ({
            languageCode: 'zz-cache-test',
            languageConfig: { code: 'zz-cache-test' },
        }),
    }));

    return import('./useDynamicTranslations');
};

describe('useDynamicTranslations helpers', () => {
    beforeEach(async () => {
        translateTextsMock.mockClear();
        ({
            collectDynamicTranslationTexts,
            shouldTranslateDynamicText,
            translateDynamicTextBatch,
            useDynamicTranslations,
        } = await loadHookModule());
        window.localStorage.clear();
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

    it('does not re-trigger translation state updates when the same text batch is rebuilt', async () => {
        const React = await import('react');
        const renderCount = { current: 0 };

        function Harness({ value }) {
            renderCount.current += 1;
            const values = [value];
            const { translateText } = useDynamicTranslations(values);
            return React.createElement('div', null, translateText(value));
        }

        const { rerender } = render(React.createElement(Harness, { value: 'Hello world' }));

        await waitFor(() => {
            expect(screen.getByText('zz-cache-test:Hello world')).toBeTruthy();
        });

        const settledRenderCount = renderCount.current;

        rerender(React.createElement(Harness, { value: 'Hello world' }));

        await waitFor(() => {
            expect(screen.getByText('zz-cache-test:Hello world')).toBeTruthy();
        });

        expect(translateTextsMock).toHaveBeenCalledTimes(1);
        expect(renderCount.current).toBeLessThanOrEqual(settledRenderCount + 1);
    });

    it('hydrates persisted translations on reload without waiting for another network request', async () => {
        const React = await import('react');

        await translateDynamicTextBatch({
            texts: ['Hello world'],
            language: 'zz-cache-test',
        });

        expect(translateTextsMock).toHaveBeenCalledTimes(1);

        ({
            useDynamicTranslations,
        } = await loadHookModule());
        translateTextsMock.mockClear();

        function Harness() {
            const { translateText } = useDynamicTranslations(['Hello world']);
            return React.createElement('div', null, translateText('Hello world'));
        }

        await act(async () => {
            render(React.createElement(Harness));
        });

        expect(screen.getByText('zz-cache-test:Hello world')).toBeTruthy();
        expect(translateTextsMock).not.toHaveBeenCalled();
    });
});
