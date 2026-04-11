const SAFE_NOTIFICATION_ORIGIN = 'https://app.invalid';

const normalizeText = (value) => (
    typeof value === 'string'
        ? value.trim()
        : ''
);

const buildPathFromUrl = (url) => `${url.pathname}${url.search}${url.hash}`;

const sanitizeRelativeNotificationPath = (value = '') => {
    const normalized = normalizeText(value);
    if (!normalized || normalized.includes('\\') || !normalized.startsWith('/')) {
        return '';
    }

    try {
        const parsed = new URL(normalized, SAFE_NOTIFICATION_ORIGIN);
        if (parsed.origin !== SAFE_NOTIFICATION_ORIGIN) {
            return '';
        }

        return buildPathFromUrl(parsed);
    } catch {
        return '';
    }
};

const sanitizeMailtoNotificationTarget = (value = '') => {
    const normalized = normalizeText(value);
    if (!normalized) {
        return '';
    }

    try {
        const parsed = new URL(normalized);
        if (parsed.protocol !== 'mailto:' || !normalizeText(parsed.pathname)) {
            return '';
        }

        return parsed.toString();
    } catch {
        return '';
    }
};

const sanitizeNotificationActionUrl = (value = '') => (
    sanitizeRelativeNotificationPath(value)
    || sanitizeMailtoNotificationTarget(value)
    || ''
);

module.exports = {
    sanitizeMailtoNotificationTarget,
    sanitizeNotificationActionUrl,
    sanitizeRelativeNotificationPath,
};
