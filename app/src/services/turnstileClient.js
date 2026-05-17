const TURNSTILE_SCRIPT_ID = 'aura-turnstile-api';
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptLoadPromise = null;

const normalizeText = (value) => String(value || '').trim();

const parseEnabledFlag = (value, fallback = true) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    return fallback;
};

export const getTurnstileSiteKey = (env = import.meta.env) => {
    const siteKey = normalizeText(env?.VITE_TURNSTILE_SITE_KEY);
    if (!siteKey) return '';

    const enabled = parseEnabledFlag(env?.VITE_TURNSTILE_ENABLED, true)
        && parseEnabledFlag(env?.VITE_AUTH_TURNSTILE_ENABLED, true);
    return enabled ? siteKey : '';
};

export const isTurnstileEnabled = (env = import.meta.env) => Boolean(getTurnstileSiteKey(env));

export const loadTurnstileScript = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return Promise.reject(new Error('Turnstile is available only in a browser runtime.'));
    }
    if (window.turnstile?.render) {
        return Promise.resolve(window.turnstile);
    }
    if (scriptLoadPromise) {
        return scriptLoadPromise;
    }

    scriptLoadPromise = new Promise((resolve, reject) => {
        const existingScript = document.getElementById(TURNSTILE_SCRIPT_ID);
        const handleLoad = () => {
            if (window.turnstile?.render) {
                resolve(window.turnstile);
                return;
            }
            reject(new Error('Turnstile script loaded without an API.'));
        };
        const handleError = () => reject(new Error('Turnstile script failed to load.'));

        if (existingScript) {
            existingScript.addEventListener('load', handleLoad, { once: true });
            existingScript.addEventListener('error', handleError, { once: true });
            return;
        }

        const script = document.createElement('script');
        script.id = TURNSTILE_SCRIPT_ID;
        script.src = TURNSTILE_SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        script.addEventListener('load', handleLoad, { once: true });
        script.addEventListener('error', handleError, { once: true });
        document.head.appendChild(script);
    });

    return scriptLoadPromise;
};

export const renderTurnstile = async (container, {
    siteKey = getTurnstileSiteKey(),
    action = 'auth',
    onToken,
    onExpire,
    onError,
} = {}) => {
    if (!container || !siteKey) {
        return null;
    }

    const api = await loadTurnstileScript();
    return api.render(container, {
        sitekey: siteKey,
        action: normalizeText(action) || 'auth',
        callback: (token) => onToken?.(String(token || '').trim()),
        'expired-callback': () => onExpire?.(),
        'error-callback': () => onError?.(),
    });
};

export const resetTurnstile = (widgetId) => {
    if (typeof window === 'undefined' || !window.turnstile?.reset || widgetId === null || widgetId === undefined) {
        return;
    }
    window.turnstile.reset(widgetId);
};

export const removeTurnstile = (widgetId) => {
    if (typeof window === 'undefined' || !window.turnstile?.remove || widgetId === null || widgetId === undefined) {
        return;
    }
    window.turnstile.remove(widgetId);
};
