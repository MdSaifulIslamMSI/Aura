import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
    FIGMA_COLOR_MODE_OPTIONS,
    FIGMA_COLOR_MODE_VALUES,
    FIGMA_DEFAULT_COLOR_MODE,
} from '../config/figmaTokens';

const STORAGE_KEY = 'aura_color_mode';
const DEFAULT_MODE = FIGMA_DEFAULT_COLOR_MODE;
export const COLOR_MODE_OPTIONS = FIGMA_COLOR_MODE_OPTIONS;
const MODE_VALUES = FIGMA_COLOR_MODE_VALUES;

const ColorModeContext = createContext(null);

function getInitialMode() {
    if (typeof window === 'undefined') return DEFAULT_MODE;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return MODE_VALUES.has(saved) ? saved : DEFAULT_MODE;
}

export function ColorModeProvider({ children }) {
    const [colorMode, setColorMode] = useState(getInitialMode);

    useEffect(() => {
        document.documentElement.setAttribute('data-color-mode', colorMode);
        document.documentElement.style.setProperty('color-scheme', colorMode === 'white' ? 'light' : 'dark');
        window.localStorage.setItem(STORAGE_KEY, colorMode);
    }, [colorMode]);

    const value = useMemo(
        () => ({
            colorMode,
            setColorMode: (mode) => {
                if (MODE_VALUES.has(mode)) {
                    setColorMode(mode);
                }
            },
            colorModeOptions: COLOR_MODE_OPTIONS,
            toggleColorMode: () =>
                setColorMode((prev) => {
                    const currentIndex = COLOR_MODE_OPTIONS.findIndex((mode) => mode.value === prev);
                    const nextIndex = (currentIndex + 1) % COLOR_MODE_OPTIONS.length;
                    return COLOR_MODE_OPTIONS[nextIndex].value;
                }),
        }),
        [colorMode]
    );

    return <ColorModeContext.Provider value={value}>{children}</ColorModeContext.Provider>;
}

export function useColorMode() {
    const context = useContext(ColorModeContext);
    if (!context) {
        throw new Error('useColorMode must be used inside ColorModeProvider');
    }
    return context;
}
