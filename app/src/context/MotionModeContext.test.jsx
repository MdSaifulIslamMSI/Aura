import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
    MotionModeProvider,
    useMotionMode,
    MOTION_MODE_OPTIONS,
} from './MotionModeContext';

const STORAGE_KEY = 'aura_motion_mode';

const createMatchMedia = (reducedMotion) => vi.fn().mockImplementation((query) => ({
    matches: reducedMotion && query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
}));

const wrapper = ({ children }) => <MotionModeProvider>{children}</MotionModeProvider>;

const renderMotionMode = () => renderHook(() => useMotionMode(), { wrapper });

describe('MotionModeContext', () => {
    const originalMatchMedia = window.matchMedia;

    beforeEach(() => {
        window.localStorage.clear();
        document.documentElement.removeAttribute('data-motion-mode');
        document.documentElement.removeAttribute('data-motion-effective');
        document.documentElement.removeAttribute('data-motion-auto');
    });

    afterEach(() => {
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            configurable: true,
            value: originalMatchMedia,
        });
    });

    it('defaults to the balanced motion mode with a normal device tier', () => {
        window.matchMedia = createMatchMedia(false);
        const { result } = renderMotionMode();

        expect(result.current.motionMode).toBe('balanced');
        expect(result.current.effectiveMotionMode).toBe('balanced');
        expect(result.current.autoDowngraded).toBe(false);
        expect(result.current.motionModeOptions).toEqual(MOTION_MODE_OPTIONS);
        expect(result.current.performanceProfile).toMatchObject({
            deviceTier: 'normal',
            runtimeTier: 'disabled',
            reducedMotion: false,
        });
    });

    it('restores a persisted valid motion mode', () => {
        window.matchMedia = createMatchMedia(false);
        window.localStorage.setItem(STORAGE_KEY, 'cinematic');
        const { result } = renderMotionMode();
        expect(result.current.motionMode).toBe('cinematic');
        expect(result.current.effectiveMotionMode).toBe('cinematic');
    });

    it('falls back to balanced for invalid persisted values', () => {
        window.matchMedia = createMatchMedia(false);
        window.localStorage.setItem(STORAGE_KEY, 'ultra');
        const { result } = renderMotionMode();
        expect(result.current.motionMode).toBe('balanced');
    });

    it('persists accepted modes and ignores unknown ones', async () => {
        window.matchMedia = createMatchMedia(false);
        const { result } = renderMotionMode();

        act(() => {
            result.current.setMotionMode('minimal');
        });
        expect(result.current.motionMode).toBe('minimal');
        await waitFor(() => {
            expect(window.localStorage.getItem(STORAGE_KEY)).toBe('minimal');
        });

        act(() => {
            result.current.setMotionMode('nope');
        });
        expect(result.current.motionMode).toBe('minimal');
    });

    it('cycles cinematic -> balanced -> minimal with cycleMotionMode', () => {
        window.matchMedia = createMatchMedia(false);
        const { result } = renderMotionMode();

        act(() => {
            result.current.setMotionMode('cinematic');
        });
        act(() => {
            result.current.cycleMotionMode();
        });
        expect(result.current.motionMode).toBe('balanced');
        act(() => {
            result.current.cycleMotionMode();
        });
        expect(result.current.motionMode).toBe('minimal');
        act(() => {
            result.current.cycleMotionMode();
        });
        expect(result.current.motionMode).toBe('cinematic');
    });

    it('downgrades to minimal when the user prefers reduced motion', () => {
        window.matchMedia = createMatchMedia(true);
        window.localStorage.setItem(STORAGE_KEY, 'cinematic');
        const { result } = renderMotionMode();

        expect(result.current.effectiveMotionMode).toBe('minimal');
        expect(result.current.autoDowngraded).toBe(true);
        expect(result.current.performanceProfile.deviceTier).toBe('severe');
        expect(result.current.performanceProfile.reducedMotion).toBe(true);
    });

    it('downgrades a cinematic request to balanced on a constrained device', () => {
        window.matchMedia = createMatchMedia(false);
        Object.defineProperty(window.navigator, 'hardwareConcurrency', {
            configurable: true,
            value: 2,
        });
        window.localStorage.setItem(STORAGE_KEY, 'cinematic');

        const { result } = renderMotionMode();
        expect(result.current.performanceProfile.deviceTier).toBe('severe');
        expect(result.current.effectiveMotionMode).toBe('minimal');

        Object.defineProperty(window.navigator, 'hardwareConcurrency', {
            configurable: true,
            value: 4,
        });
    });

    it('writes data-motion-* attributes onto the document element', async () => {
        window.matchMedia = createMatchMedia(false);
        const { result } = renderMotionMode();

        act(() => {
            result.current.setMotionMode('minimal');
        });

        await waitFor(() => {
            expect(document.documentElement.getAttribute('data-motion-mode')).toBe('minimal');
        });
        expect(document.documentElement.getAttribute('data-motion-effective')).toBe('minimal');
        expect(document.documentElement.getAttribute('data-motion-auto')).toBe('0');
    });

    it('throws when useMotionMode is used outside the provider', () => {
        expect(() => renderHook(() => useMotionMode())).toThrow(
            'useMotionMode must be used inside MotionModeProvider'
        );
    });
});
