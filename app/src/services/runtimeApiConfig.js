export const trimTrailingSlash = (value = '') => String(value || '').replace(/\/+$/, '');

export const getSafeEnv = (key, fallback = '') => {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env) {
            return import.meta.env[key] || fallback;
        }
        if (typeof process !== 'undefined' && process.env) {
            return process.env[key] || fallback;
        }
    } catch {
        // Fall back to the provided default.
    }
    return fallback;
};

const isHostedVercelRuntime = () => {
    if (typeof window === 'undefined') return false;
    const host = String(window.location?.hostname || '').toLowerCase();
    return host.endsWith('.vercel.app');
};

export const resolveApiBaseUrl = (fallback = '/api') => {
    if (isHostedVercelRuntime()) {
        return '/api';
    }

    return trimTrailingSlash(getSafeEnv('VITE_API_URL', fallback)) || fallback;
};
