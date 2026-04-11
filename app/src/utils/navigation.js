const SAFE_FALLBACK_ORIGIN = 'https://app.invalid';

const safeString = (value = '') => String(value ?? '');

const isAbsoluteLike = (value = '') => /^[a-z][a-z0-9+.-]*:/i.test(value) || String(value).startsWith('//');

const buildPathFromUrl = (url) => `${url.pathname}${url.search}${url.hash}`;

const resolveBaseOrigin = (origin = '') => {
    const normalized = safeString(origin).trim();
    if (normalized) {
        return normalized;
    }

    if (typeof window !== 'undefined' && window.location?.origin) {
        return window.location.origin;
    }

    return SAFE_FALLBACK_ORIGIN;
};

const normalizeRouteTarget = (target) => {
    if (typeof target === 'string') {
        return safeString(target).trim();
    }

    const pathname = safeString(target?.pathname).trim();
    if (!pathname) {
        return '';
    }

    return `${pathname}${safeString(target?.search)}${safeString(target?.hash)}`;
};

const resolveInternalPath = (target, { origin = '' } = {}) => {
    const normalized = safeString(target).trim();
    if (!normalized || normalized.includes('\\')) {
        return '';
    }

    const absoluteLike = isAbsoluteLike(normalized);
    if (!absoluteLike && !normalized.startsWith('/')) {
        return '';
    }

    const baseOrigin = resolveBaseOrigin(origin);

    try {
        const parsed = new URL(normalized, baseOrigin);
        if (parsed.origin !== baseOrigin) {
            return '';
        }

        if (absoluteLike && !['http:', 'https:'].includes(parsed.protocol)) {
            return '';
        }

        return buildPathFromUrl(parsed);
    } catch {
        return '';
    }
};

const resolveMailtoTarget = (target) => {
    const normalized = safeString(target).trim();
    if (!normalized) {
        return '';
    }

    try {
        const parsed = new URL(normalized);
        if (parsed.protocol !== 'mailto:' || !safeString(parsed.pathname).trim()) {
            return '';
        }
        return parsed.toString();
    } catch {
        return '';
    }
};

export const resolveNavigationTarget = (target, fallback = '/') => (
    resolveInternalPath(normalizeRouteTarget(target)) || fallback
);

export const resolveNotificationActionTarget = (target, options = {}) => {
    const internalTarget = resolveInternalPath(target, options);
    if (internalTarget) {
        return {
            kind: 'internal',
            href: internalTarget,
        };
    }

    const mailtoTarget = resolveMailtoTarget(target);
    if (mailtoTarget) {
        return {
            kind: 'external',
            href: mailtoTarget,
        };
    }

    return null;
};
