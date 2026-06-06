const { canonicalizeAction, getSensitiveActionPolicy } = require('./sensitiveActionRegistry');

const DEFAULT_FRESHNESS_WINDOWS_SECONDS = Object.freeze({
    criticalAdminAction: 5 * 60,
    refundExportApiKeyAction: 10 * 60,
    accountSecurityChange: 5 * 60,
    normalAccountUpdate: 30 * 60,
});

const parsePositiveSeconds = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getFreshnessWindows = (env = process.env) => ({
    criticalAdminAction: parsePositiveSeconds(
        env.SECURITY_FRESH_ADMIN_SECONDS,
        DEFAULT_FRESHNESS_WINDOWS_SECONDS.criticalAdminAction
    ),
    refundExportApiKeyAction: parsePositiveSeconds(
        env.SECURITY_FRESH_REFUND_EXPORT_APIKEY_SECONDS,
        DEFAULT_FRESHNESS_WINDOWS_SECONDS.refundExportApiKeyAction
    ),
    accountSecurityChange: parsePositiveSeconds(
        env.SECURITY_FRESH_ACCOUNT_CHANGE_SECONDS,
        DEFAULT_FRESHNESS_WINDOWS_SECONDS.accountSecurityChange
    ),
    normalAccountUpdate: parsePositiveSeconds(
        env.SECURITY_FRESH_ACCOUNT_UPDATE_SECONDS,
        DEFAULT_FRESHNESS_WINDOWS_SECONDS.normalAccountUpdate
    ),
});

const getFreshnessWindowSeconds = (action = '', env = process.env) => {
    const canonical = canonicalizeAction(action);
    const windows = getFreshnessWindows(env);
    if (canonical.startsWith('admin.') || canonical === 'database.maintenance' || canonical === 'tenant.delete') {
        return windows.criticalAdminAction;
    }
    if (canonical.startsWith('payment.refund') || canonical.startsWith('data.') || canonical.startsWith('apikey.')) {
        return windows.refundExportApiKeyAction;
    }
    if (canonical.startsWith('auth.') || canonical.startsWith('session.')) {
        return windows.accountSecurityChange;
    }
    return windows.normalAccountUpdate;
};

const isFreshAuthSatisfied = (context = {}, actionPolicy = null, env = process.env) => {
    const policy = actionPolicy || getSensitiveActionPolicy(context.action) || {};
    if (!policy.requiresFreshAuth) {
        return { ok: true, reason: 'fresh_auth_not_required' };
    }

    const windowSeconds = getFreshnessWindowSeconds(policy.action || context.action, env);
    const sessionAgeSeconds = Number(context.sessionAgeSeconds);
    if (!Number.isFinite(sessionAgeSeconds)) {
        return { ok: false, reason: 'session_age_unknown', windowSeconds };
    }
    if (sessionAgeSeconds > windowSeconds) {
        return { ok: false, reason: 'session_too_old', windowSeconds };
    }
    if (policy.requiresMfa && !context.mfaFresh && !context.passkeyFresh) {
        return { ok: false, reason: 'mfa_freshness_missing', windowSeconds };
    }
    if (policy.requiresPasskeyForAdmin && !context.passkeyFresh) {
        const requireAdminPasskey = String(env.SECURITY_REQUIRE_ADMIN_PASSKEY || 'false').trim().toLowerCase() === 'true';
        if (requireAdminPasskey || context.role === 'admin') {
            return { ok: false, reason: 'passkey_freshness_missing', windowSeconds };
        }
    }

    return { ok: true, reason: 'fresh_auth_satisfied', windowSeconds };
};

module.exports = {
    DEFAULT_FRESHNESS_WINDOWS_SECONDS,
    getFreshnessWindowSeconds,
    getFreshnessWindows,
    isFreshAuthSatisfied,
};
