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

export const resolveApiBaseUrl = (fallback = '/api') => {
    const configured = trimTrailingSlash(getSafeEnv('VITE_API_URL', ''));
    return configured || fallback;
};

export const resolveServiceOrigin = (fallback = '') => {
    const raw = trimTrailingSlash(getSafeEnv('VITE_API_URL', fallback));

    if (/^https?:\/\//i.test(raw)) {
        try {
            const url = new URL(raw);
            const pathname = trimTrailingSlash(url.pathname);
            const servicePath = pathname.replace(/\/api$/i, '');
            return trimTrailingSlash(`${url.origin}${servicePath}`);
        } catch {
            return raw;
        }
    }

    if (typeof window !== 'undefined') {
        return trimTrailingSlash(window.location.origin);
    }

    return raw;
};
