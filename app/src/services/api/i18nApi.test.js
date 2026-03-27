import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearI18nApiCache, i18nApi } from './i18nApi';

const { apiFetchMock } = vi.hoisted(() => ({
    apiFetchMock: vi.fn(),
}));

vi.mock('../apiBase', () => ({
    apiFetch: apiFetchMock,
}));

describe('i18nApi', () => {
    beforeEach(() => {
        clearI18nApiCache();
        apiFetchMock.mockReset();
    });

    it('dedupes overlapping requests and reuses cached translations', async () => {
        apiFetchMock.mockResolvedValue({
            data: {
                translations: {
                    Hello: 'es:Hello',
                },
            },
        });

        const [first, second] = await Promise.all([
            i18nApi.translateTexts({ texts: ['Hello'], language: 'es' }),
            i18nApi.translateTexts({ texts: ['Hello'], language: 'es' }),
        ]);

        expect(first).toEqual({ Hello: 'es:Hello' });
        expect(second).toEqual({ Hello: 'es:Hello' });
        expect(apiFetchMock).toHaveBeenCalledTimes(1);

        const cached = await i18nApi.translateTexts({ texts: ['Hello'], language: 'es' });
        expect(cached).toEqual({ Hello: 'es:Hello' });
        expect(apiFetchMock).toHaveBeenCalledTimes(1);
    });

    it('short-circuits English requests without calling the API', async () => {
        const result = await i18nApi.translateTexts({ texts: ['Hello'], language: 'en' });
        expect(result).toEqual({ Hello: 'Hello' });
        expect(apiFetchMock).not.toHaveBeenCalled();
    });

    it('falls back to the source text when the upstream request fails', async () => {
        apiFetchMock.mockRejectedValue(new Error('upstream down'));

        const result = await i18nApi.translateTexts({ texts: ['Hello'], language: 'es' });
        expect(result).toEqual({ Hello: 'Hello' });
    });
});
