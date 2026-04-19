import { useEffect, useRef } from 'react';

export const DEFAULT_ACTIVE_WINDOW_REFRESH_INTERVAL_MS = 30 * 1000;

const isWindowVisible = () => (
    typeof document === 'undefined' || document.visibilityState !== 'hidden'
);

const isWindowOnline = () => (
    typeof navigator === 'undefined' || navigator.onLine !== false
);

export function useActiveWindowRefresh(callback, {
    enabled = true,
    intervalMs = DEFAULT_ACTIVE_WINDOW_REFRESH_INTERVAL_MS,
} = {}) {
    const callbackRef = useRef(callback);
    const inFlightRefreshRef = useRef(null);

    useEffect(() => {
        callbackRef.current = callback;
    }, [callback]);

    useEffect(() => {
        if (!enabled || typeof window === 'undefined' || typeof document === 'undefined') {
            return undefined;
        }

        let disposed = false;

        const runRefresh = () => {
            if (disposed || typeof callbackRef.current !== 'function' || !isWindowVisible() || !isWindowOnline()) {
                return Promise.resolve();
            }

            if (inFlightRefreshRef.current) {
                return inFlightRefreshRef.current;
            }

            const refreshPromise = Promise.resolve()
                .then(() => callbackRef.current?.())
                .catch(() => {})
                .finally(() => {
                    if (inFlightRefreshRef.current === refreshPromise) {
                        inFlightRefreshRef.current = null;
                    }
                });

            inFlightRefreshRef.current = refreshPromise;
            return refreshPromise;
        };

        const handleFocus = () => {
            void runRefresh();
        };

        const handleOnline = () => {
            void runRefresh();
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void runRefresh();
            }
        };

        const intervalId = intervalMs > 0
            ? window.setInterval(() => {
                void runRefresh();
            }, intervalMs)
            : null;

        window.addEventListener('focus', handleFocus);
        window.addEventListener('online', handleOnline);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            disposed = true;

            if (intervalId !== null) {
                window.clearInterval(intervalId);
            }

            window.removeEventListener('focus', handleFocus);
            window.removeEventListener('online', handleOnline);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [enabled, intervalMs]);
}
