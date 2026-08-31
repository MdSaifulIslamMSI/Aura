import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { React } from 'react';
import { ColorModeProvider, useColorMode, COLOR_MODE_OPTIONS } from './ColorModeContext';
import { FIGMA_DEFAULT_COLOR_MODE } from '../config/figmaTokens';

const STORAGE_KEY = 'aura_color_mode';

const wrapper = ({ children }) => <ColorModeProvider>{children}</ColorModeProvider>;

describe('ColorModeContext', () => {
    beforeEach(() => {
        window.localStorage.clear();
        document.documentElement.removeAttribute('data-color-mode');
        document.documentElement.style.removeProperty('color-scheme');
    });

    it('defaults to the Figma token color mode', () => {
        const { result } = renderHook(() => useColorMode(), { wrapper });
        expect(result.current.colorMode).toBe(FIGMA_DEFAULT_COLOR_MODE);
        expect(result.current.colorModeOptions).toEqual(COLOR_MODE_OPTIONS);
    });

    it('restores a persisted valid color mode on init', () => {
        window.localStorage.setItem(STORAGE_KEY, 'violet');
        const { result } = renderHook(() => useColorMode(), { wrapper });
        expect(result.current.colorMode).toBe('violet');
    });

    it('falls back to the default when the persisted value is invalid', () => {
        window.localStorage.setItem(STORAGE_KEY, 'hot-pink');
        const { result } = renderHook(() => useColorMode(), { wrapper });
        expect(result.current.colorMode).toBe(FIGMA_DEFAULT_COLOR_MODE);
    });

    it('applies data-color-mode and color-scheme to the document and persists changes', async () => {
        const { result } = renderHook(() => useColorMode(), { wrapper });

        act(() => {
            result.current.setColorMode('white');
        });

        await waitFor(() => {
            expect(document.documentElement.getAttribute('data-color-mode')).toBe('white');
        });
        expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('light');
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('white');
    });

    it('ignores color modes that are not part of the option list', () => {
        const { result } = renderHook(() => useColorMode(), { wrapper });

        act(() => {
            result.current.setColorMode('not-a-mode');
        });

        expect(result.current.colorMode).toBe(FIGMA_DEFAULT_COLOR_MODE);
    });

    it('cycles through every color mode with toggleColorMode', () => {
        const { result } = renderHook(() => useColorMode(), { wrapper });

        for (let index = 1; index < COLOR_MODE_OPTIONS.length; index += 1) {
            act(() => {
                result.current.toggleColorMode();
            });
            expect(result.current.colorMode).toBe(COLOR_MODE_OPTIONS[index].value);
        }

        // One more toggle wraps back to the first option.
        act(() => {
            result.current.toggleColorMode();
        });
        expect(result.current.colorMode).toBe(COLOR_MODE_OPTIONS[0].value);
    });

    it('throws when useColorMode is used outside the provider', () => {
        expect(() => renderHook(() => useColorMode())).toThrow(
            'useColorMode must be used inside ColorModeProvider'
        );
    });
});
