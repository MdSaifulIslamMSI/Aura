const safeString = (value = '') => String(value ?? '');

export const resolveNavigationTarget = (target, fallback = '/') => {
    if (typeof target === 'string') {
        const normalized = safeString(target).trim();
        return normalized || fallback;
    }

    const pathname = safeString(target?.pathname).trim();
    if (!pathname) {
        return fallback;
    }

    return `${pathname}${safeString(target?.search)}${safeString(target?.hash)}`;
};
