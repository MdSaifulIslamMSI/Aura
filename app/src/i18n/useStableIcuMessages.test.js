import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOptionalMarket } from '@/context/MarketContext';
import { catalogs, loadCatalog } from './catalogs';
import { useStableIcuMessages } from './useStableIcuMessages';

vi.mock('@/context/MarketContext', () => ({
    useOptionalMarket: vi.fn(() => null),
}));

describe('useStableIcuMessages', () => {
    beforeEach(() => {
        useOptionalMarket.mockReset();
        useOptionalMarket.mockReturnValue(null);
    });

    it('formats catalog-backed ids through ICU at runtime', () => {
        const { result } = renderHook(() => useStableIcuMessages());
        const t = result.current;

        expect(t('accessibility.hidePassword')).toBe('Hide password');
        expect(t('accessibility.openCart', { count: 0 })).toBe('Open cart with no items');
        expect(t('accessibility.openCart', { count: 3 })).toBe('Open cart with 3 items');
    });

    it('falls back to the provided fallback string for unknown ids', () => {
        const { result } = renderHook(() => useStableIcuMessages());
        const t = result.current;

        expect(t('no.such.message', {}, 'Shown Fallback')).toBe('Shown Fallback');
    });

    it('returns the id itself when there is no fallback or legacy translator', () => {
        const { result } = renderHook(() => useStableIcuMessages());
        expect(result.current('no.such.message')).toBe('no.such.message');
    });

    it('delegates unknown ids to the legacy translator but never catalog ids', () => {
        const legacyTranslate = vi.fn((id) => `legacy:${id}`);
        const { result } = renderHook(() => useStableIcuMessages(legacyTranslate));
        const t = result.current;

        expect(t('no.such.message', { x: 1 }, 'ignored')).toBe('legacy:no.such.message');
        expect(t('accessibility.hidePassword')).toBe('Hide password');
        expect(legacyTranslate).toHaveBeenCalledTimes(1);
    });

    it('uses the market language catalog once that locale is loaded', async () => {
        await loadCatalog('hi');
        // Non-English catalogs only engage when the FormatJS flag is enabled.
        vi.stubEnv('VITE_I18N_FORMATJS_ENABLED', 'true');
        useOptionalMarket.mockReturnValue({ languageCode: 'hi', locale: 'hi-IN' });

        const { result } = renderHook(() => useStableIcuMessages());
        const t = result.current;

        expect(t('accessibility.hidePassword')).toBe(catalogs.hi['accessibility.hidePassword']);
        expect(t('accessibility.hidePassword')).not.toBe('');
        vi.unstubAllEnvs();
    });
});
