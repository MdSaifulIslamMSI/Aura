export const trimTrailingSlash = (value = '') => String(value || '').replace(/\/+$/, '');

const parseBooleanEnv = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

export const normalizeHost = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');

const isAbsoluteHttpUrl = (value = '') => /^https?:\/\//i.test(String(value || '').trim());

const isSupportedApiBaseUrl = (value = '') => {
    const normalized = String(value || '').trim();
    return isAbsoluteHttpUrl(normalized) || normalized.startsWith('/');
};

const HOSTED_FRONTEND_EXACT_HOSTS = new Set(['aurapilot.aws.app']);

// Suffixes for frontend hosts that proxy /api (and /health, /uploads,
// /socket.io) same-origin to the backend edge (Netlify/Vercel rewrites,
// Render routes, Railway Caddy). Static-only lanes (Cloudflare Pages,
// GitHub Pages, S3 website) have no same-origin proxy and call the backend
// directly, so they are deliberately NOT listed here.
const HOSTED_FRONTEND_HOST_SUFFIXES = [
  '.vercel.app',
  '.netlify.app',
  '.cloudfront.net',
  '.onrender.com',
  '.railway.app',
  '.up.railway.app',
];

export const isHostedFrontendRuntimeHost = (host = '') => {
    const normalizedHost = normalizeHost(host);
    return HOSTED_FRONTEND_EXACT_HOSTS.has(normalizedHost)
        || HOSTED_FRONTEND_HOST_SUFFIXES.some((suffix) => normalizedHost.endsWith(suffix));
};

export const isLocalFrontendRuntimeHost = (host = '') => {
    const normalizedHost = normalizeHost(host);
    return normalizedHost === 'localhost'
        || normalizedHost === '127.0.0.1'
        || normalizedHost === '::1'
        || normalizedHost.endsWith('.local');
};

const shouldPreferLocalProxyApi = (configured = '', fallback = '/api') => {
    if (typeof window === 'undefined') return false;
    if (!String(fallback || '').startsWith('/')) return false;
    if (!isAbsoluteHttpUrl(configured)) return false;

    const allowRemoteLocalApi = parseBooleanEnv(
        getSafeEnv('VITE_API_URL_ALLOW_REMOTE_LOCAL', ''),
        false
    );
    if (allowRemoteLocalApi) {
        return false;
    }

    const runtimeHost = window.location.host || window.location.hostname || '';
    return isLocalFrontendRuntimeHost(runtimeHost);
};

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
    if (!isHostedFrontendRuntimeHost(runtimeHost)) {
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
    if (configured && !isSupportedApiBaseUrl(configured)) {
        return fallback;
    }
    if (shouldPreferLocalProxyApi(configured, fallback)) {
        return fallback;
    }
    if (shouldPreferHostedProxyApi(configured, fallback)) {
        return fallback;
    }
    return configured || fallback;
};

export const resolveServiceOrigin = (fallback = '') => {
    const configured = trimTrailingSlash(getSafeEnv('VITE_API_URL', fallback));
    const raw = configured && isSupportedApiBaseUrl(configured)
        ? configured
        : trimTrailingSlash(fallback);

    if (shouldPreferLocalProxyApi(raw, fallback)) {
        return typeof window !== 'undefined'
            ? trimTrailingSlash(window.location.origin)
            : trimTrailingSlash(fallback);
    }

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
