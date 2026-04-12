export const trimTrailingSlash = (value = '') => String(value || '').replace(/\/+$/, '');

const parseBooleanEnv = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const normalizeHost = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');

const isAbsoluteHttpUrl = (value = '') => /^https?:\/\//i.test(String(value || '').trim());

const shouldPreferHostedProxyApi = (configured = '', fallback = '/api') => {
    if (typeof window === 'undefined') return false;
    if (!String(fallback || '').startsWith('/')) return false;
    if (!isAbsoluteHttpUrl(configured)) return false;

    const allowCrossOriginOnHostedFrontends = parseBooleanEnv(
        getSafeEnv('VITE_API_URL_ALLOW_CROSS_ORIGIN_HOSTED', ''),
        false
    );
    if (allowCrossOriginOnHostedFrontends) {
        return false;
    }

    const runtimeHost = normalizeHost(window.location.host || window.location.hostname || '');
    if (!runtimeHost.endsWith('.vercel.app')) {
        return false;
    }

    try {
        const configuredUrl = new URL(configured);
        const configuredHost = normalizeHost(configuredUrl.host || configuredUrl.hostname || '');
        return Boolean(configuredHost && configuredHost !== runtimeHost);
    } catch {
        return false;
    }
};

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
    if (shouldPreferHostedProxyApi(configured, fallback)) {
        return fallback;
    }
    return configured || fallback;
};

export const resolveServiceOrigin = (fallback = '') => {
    const raw = trimTrailingSlash(getSafeEnv('VITE_API_URL', fallback));

    if (shouldPreferHostedProxyApi(raw, fallback)) {
        return typeof window !== 'undefined'
            ? trimTrailingSlash(window.location.origin)
            : trimTrailingSlash(fallback);
    }

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
