export const ADMIN_ACCESS_LOCK_EVENT = 'aura:admin-access:locked';

export const ADMIN_ACCESS_LOCK_CODES = {
    ALLOWLIST_MISSING: 'ADMIN_ALLOWLIST_MISSING',
    ALLOWLIST_DENIED: 'ADMIN_ALLOWLIST_DENIED',
};

const ADMIN_ACCESS_LOCK_MESSAGE_PATTERNS = [
    'admin access is locked',
    'allowlist is not configured',
    'admin access denied for this account',
];

const normalizeCode = (value = '') => String(value || '').trim().toUpperCase();

const normalizeReason = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

const normalizeMessage = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

export const isAdminAccessLockCode = (code = '') => (
    Object.values(ADMIN_ACCESS_LOCK_CODES).includes(normalizeCode(code))
);

export const isAdminAccessLockMessage = (message = '') => {
    const normalized = normalizeMessage(message).toLowerCase();
    if (!normalized) return false;
    return ADMIN_ACCESS_LOCK_MESSAGE_PATTERNS.some((pattern) => normalized.includes(pattern));
};

export const getAdminAccessLockTitle = (lock = {}) => (
    normalizeCode(lock?.code) === ADMIN_ACCESS_LOCK_CODES.ALLOWLIST_DENIED
        ? 'Admin account is not allowlisted'
        : 'Admin access is locked'
);

export const getAdminAccessLockOperatorMessage = (lock = {}) => {
    const code = normalizeCode(lock?.code);

    if (code === ADMIN_ACCESS_LOCK_CODES.ALLOWLIST_DENIED) {
        return 'This signed-in account is not in the production admin allowlist. Admin tools stay blocked until an approved operator adds the account to ADMIN_ALLOWLIST_EMAILS and the backend reloads that runtime configuration.';
    }

    return 'Production admin allowlist configuration is missing. Admin tools stay blocked until an approved operator sets ADMIN_ALLOWLIST_EMAILS and the backend reloads that runtime configuration.';
};

export const getAdminAccessLockPayload = ({
    status = 0,
    data = null,
    message = '',
    requestId = '',
    url = '',
} = {}) => {
    const numericStatus = Number(status || 0);
    if (numericStatus && numericStatus !== 403) return null;

    const dataObject = data && typeof data === 'object' ? data : {};
    const rawCode = normalizeCode(dataObject.code || dataObject.errorCode || '');
    const rawReason = normalizeReason(dataObject.reason || '');
    const rawMessage = normalizeMessage(
        message
        || dataObject.message
        || (typeof data === 'string' ? data : '')
    );

    if (!isAdminAccessLockCode(rawCode) && !isAdminAccessLockMessage(rawMessage)) {
        return null;
    }

    const code = isAdminAccessLockCode(rawCode)
        ? rawCode
        : rawMessage.toLowerCase().includes('denied')
            ? ADMIN_ACCESS_LOCK_CODES.ALLOWLIST_DENIED
            : ADMIN_ACCESS_LOCK_CODES.ALLOWLIST_MISSING;

    return {
        status: numericStatus || 403,
        code,
        reason: rawReason || (code === ADMIN_ACCESS_LOCK_CODES.ALLOWLIST_DENIED ? 'allowlist_denied' : 'allowlist_missing'),
        message: rawMessage || (code === ADMIN_ACCESS_LOCK_CODES.ALLOWLIST_DENIED
            ? 'Admin access denied for this account'
            : 'Admin access is locked: allowlist is not configured'),
        requestId: String(requestId || dataObject.requestId || ''),
        url: String(url || ''),
    };
};

export const getAdminAccessLockFromIntelligence = (intelligence = null) => {
    const adminAccess = intelligence?.adminAccess || intelligence?.posture?.policy?.adminAccess || null;
    if (!adminAccess?.locked) return null;

    return getAdminAccessLockPayload({
        status: 403,
        data: {
            code: adminAccess.code,
            reason: adminAccess.reason,
            message: adminAccess.message,
        },
        message: adminAccess.message,
    });
};
