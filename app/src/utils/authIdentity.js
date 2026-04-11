const INTERNAL_AUTH_EMAIL_DOMAIN = 'auth.aura.invalid';

export const normalizeEmail = (value) => (
    typeof value === 'string' ? value.trim().toLowerCase() : ''
);

export const isInternalAuthEmail = (value) => {
    const email = normalizeEmail(value);
    return Boolean(email) && email.endsWith(`@${INTERNAL_AUTH_EMAIL_DOMAIN}`);
};

export const getUserVisibleEmail = (value) => (
    isInternalAuthEmail(value) ? '' : normalizeEmail(value)
);
