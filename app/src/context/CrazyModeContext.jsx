import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'aura_hyperdrive_mode';
const CrazyModeContext = createContext(null);

const isBrowser = typeof window !== 'undefined';

const getInitialState = () => {
    if (!isBrowser) return false;
    return window.localStorage.getItem(STORAGE_KEY) === '1';
};

export function CrazyModeProvider({ children }) {
    const [crazyModeEnabled, setCrazyModeEnabled] = useState(getInitialState);

    useEffect(() => {
        if (!isBrowser) return;
        document.documentElement.setAttribute('data-crazy-mode', crazyModeEnabled ? 'on' : 'off');
        window.localStorage.setItem(STORAGE_KEY, crazyModeEnabled ? '1' : '0');
    }, [crazyModeEnabled]);

    useEffect(() => {
        if (!isBrowser) return undefined;

        const onKeyDown = (event) => {
            if (event.ctrlKey && event.shiftKey && String(event.key || '').toLowerCase() === 'h') {
                event.preventDefault();
                setCrazyModeEnabled((prev) => !prev);
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    const value = useMemo(
        () => ({
            crazyModeEnabled,
            setCrazyModeEnabled,
            toggleCrazyMode: () => setCrazyModeEnabled((prev) => !prev),
        }),
        [crazyModeEnabled]
    );

    return <CrazyModeContext.Provider value={value}>{children}</CrazyModeContext.Provider>;
}

export function useCrazyMode() {
    const context = useContext(CrazyModeContext);
    if (!context) {
        throw new Error('useCrazyMode must be used inside CrazyModeProvider');
    }
    return context;
}
