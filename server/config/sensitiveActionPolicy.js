const SENSITIVE_ACTION_CATEGORIES = Object.freeze({
    ADMIN_STATE_CHANGE: 'ADMIN_STATE_CHANGE',
    ADMIN_USER_MANAGEMENT: 'ADMIN_USER_MANAGEMENT',
    ADMIN_SECURITY_CONFIG_CHANGE: 'ADMIN_SECURITY_CONFIG_CHANGE',
    PAYMENT_REFUND: 'PAYMENT_REFUND',
    PAYMENT_PAYOUT_CHANGE: 'PAYMENT_PAYOUT_CHANGE',
    PAYMENT_WEBHOOK_REPLAY_RISK: 'PAYMENT_WEBHOOK_REPLAY_RISK',
    ORDER_STATUS_CHANGE: 'ORDER_STATUS_CHANGE',
    SELLER_APPROVAL_CHANGE: 'SELLER_APPROVAL_CHANGE',
    UPLOAD_WRITE: 'UPLOAD_WRITE',
    MODERATION_ACTION: 'MODERATION_ACTION',
    ACCOUNT_RECOVERY_CHANGE: 'ACCOUNT_RECOVERY_CHANGE',
    PASSWORD_OR_AUTH_FACTOR_CHANGE: 'PASSWORD_OR_AUTH_FACTOR_CHANGE',
    API_KEY_OR_TOKEN_CHANGE: 'API_KEY_OR_TOKEN_CHANGE',
    DATA_EXPORT: 'DATA_EXPORT',
    DATA_DELETE: 'DATA_DELETE',
    AI_TOOL_ACTION: 'AI_TOOL_ACTION',
});

const RISK_LEVELS = Object.freeze({
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    CRITICAL: 'critical',
});

const ADMIN_CATEGORIES = new Set([
    SENSITIVE_ACTION_CATEGORIES.ADMIN_STATE_CHANGE,
    SENSITIVE_ACTION_CATEGORIES.ADMIN_USER_MANAGEMENT,
    SENSITIVE_ACTION_CATEGORIES.ADMIN_SECURITY_CONFIG_CHANGE,
    SENSITIVE_ACTION_CATEGORIES.DATA_EXPORT,
    SENSITIVE_ACTION_CATEGORIES.DATA_DELETE,
]);

const ADMIN_PAYMENT_CATEGORIES = new Set([
    SENSITIVE_ACTION_CATEGORIES.PAYMENT_REFUND,
    SENSITIVE_ACTION_CATEGORIES.PAYMENT_PAYOUT_CHANGE,
]);

const parseBooleanEnv = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parsePositiveIntEnv = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const isProductionEnv = (env = process.env) => String(env.NODE_ENV || '')
    .trim()
    .toLowerCase() === 'production';

const resolveSensitiveActionPolicyConfig = (env = process.env) => {
    const production = isProductionEnv(env);
    const legacyAdminStateChangeFlag = env.AUTH_REQUIRE_WEBAUTHN_STEP_UP_FOR_ADMIN_STATE_CHANGES;

    return {
        enabled: parseBooleanEnv(env.AUTH_SENSITIVE_ACTION_POLICY_ENABLED, true),
        rollbackEnabled: parseBooleanEnv(env.AUTH_SENSITIVE_ACTION_POLICY_ROLLBACK, false),
        production,
        requireWebAuthnForAdminLogin: parseBooleanEnv(env.AUTH_REQUIRE_WEBAUTHN_FOR_ADMIN_LOGIN, production),
        requireWebAuthnForAdminStateChanges: parseBooleanEnv(
            env.AUTH_REQUIRE_WEBAUTHN_FOR_ADMIN_STATE_CHANGES ?? legacyAdminStateChangeFlag,
            production
        ),
        requireWebAuthnForAdminSecurityChanges: parseBooleanEnv(
            env.AUTH_REQUIRE_WEBAUTHN_FOR_ADMIN_SECURITY_CHANGES,
            production
        ),
        adminEnrollmentGraceDays: parsePositiveIntEnv(env.AUTH_WEBAUTHN_ADMIN_ENROLLMENT_GRACE_DAYS, 0),
        adminBreakGlassEnabled: parseBooleanEnv(env.AUTH_WEBAUTHN_ADMIN_BREAK_GLASS_ENABLED, false),
        recentAuthWindowMinutes: parsePositiveIntEnv(env.AUTH_SENSITIVE_FRESH_LOGIN_MINUTES, 15),
    };
};

const normalizePath = (value = '') => String(value || '').split('?')[0].trim().toLowerCase();

const hasAdminRole = (actor = {}) => {
    if (actor?.isAdmin === true) return true;
    const roles = [
        actor?.role,
        ...(Array.isArray(actor?.roles) ? actor.roles : []),
        ...(Array.isArray(actor?.adminRoles) ? actor.adminRoles : []),
    ].map((entry) => String(entry || '').trim().toLowerCase());
    return roles.includes('admin');
};

const classifyAdminAction = ({ method, path }) => {
    const stateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    if (path.startsWith('/api/admin/users/')) {
        return {
            action: `admin.users.${stateChanging ? 'mutate' : 'read'}`,
            category: stateChanging
                ? SENSITIVE_ACTION_CATEGORIES.ADMIN_USER_MANAGEMENT
                : SENSITIVE_ACTION_CATEGORIES.DATA_EXPORT,
            riskLevel: stateChanging ? RISK_LEVELS.CRITICAL : RISK_LEVELS.MEDIUM,
            resourceType: 'user',
        };
    }

    if (path.startsWith('/api/admin/payments/')) {
        const isRefundLedger = path.includes('/refunds/');
        return {
            action: isRefundLedger ? 'admin.payments.refund_ledger' : 'admin.payments.mutate',
            category: isRefundLedger
                ? SENSITIVE_ACTION_CATEGORIES.PAYMENT_REFUND
                : SENSITIVE_ACTION_CATEGORIES.PAYMENT_PAYOUT_CHANGE,
            riskLevel: stateChanging ? RISK_LEVELS.CRITICAL : RISK_LEVELS.HIGH,
            resourceType: 'payment',
        };
    }

    if (path.startsWith('/api/admin/emergency-controls')
        || path.startsWith('/api/admin/status')
        || path.startsWith('/api/admin/ops')) {
        return {
            action: 'admin.security_config.change',
            category: SENSITIVE_ACTION_CATEGORIES.ADMIN_SECURITY_CONFIG_CHANGE,
            riskLevel: stateChanging ? RISK_LEVELS.CRITICAL : RISK_LEVELS.HIGH,
            resourceType: 'admin_control',
        };
    }

    if (path.startsWith('/api/admin/analytics/export')) {
        return {
            action: 'admin.analytics.export',
            category: SENSITIVE_ACTION_CATEGORIES.DATA_EXPORT,
            riskLevel: RISK_LEVELS.HIGH,
            resourceType: 'analytics',
        };
    }

    if (path.startsWith('/api/admin/products/')
        || path.startsWith('/api/admin/catalog/')
        || path.startsWith('/api/admin/fraud/')) {
        return {
            action: 'admin.state.change',
            category: SENSITIVE_ACTION_CATEGORIES.ADMIN_STATE_CHANGE,
            riskLevel: stateChanging ? RISK_LEVELS.HIGH : RISK_LEVELS.MEDIUM,
            resourceType: 'admin_resource',
        };
    }

    return {
        action: stateChanging ? 'admin.state.change' : 'admin.read',
        category: stateChanging
            ? SENSITIVE_ACTION_CATEGORIES.ADMIN_STATE_CHANGE
            : SENSITIVE_ACTION_CATEGORIES.DATA_EXPORT,
        riskLevel: stateChanging ? RISK_LEVELS.HIGH : RISK_LEVELS.MEDIUM,
        resourceType: 'admin_resource',
    };
};

const classifySensitiveActionFromRequest = (req = {}) => {
    const method = String(req.method || 'GET').trim().toUpperCase();
    const path = normalizePath(req.originalUrl || req.path || '');

    if (!path || path.startsWith('/health')) {
        return null;
    }

    if (path.startsWith('/api/admin/')) {
        return classifyAdminAction({ method, path });
    }

    if (path.startsWith('/api/payments/webhooks/')) {
        return {
            action: path.includes('stripe') ? 'payment.webhook.stripe' : 'payment.webhook.razorpay',
            category: SENSITIVE_ACTION_CATEGORIES.PAYMENT_WEBHOOK_REPLAY_RISK,
            riskLevel: RISK_LEVELS.CRITICAL,
            resourceType: 'payment_webhook',
        };
    }

    if (path.includes('/refunds')) {
        return {
            action: 'payment.refund.create',
            category: SENSITIVE_ACTION_CATEGORIES.PAYMENT_REFUND,
            riskLevel: RISK_LEVELS.CRITICAL,
            resourceType: 'payment',
        };
    }

    if (path.startsWith('/api/payments/methods')) {
        return {
            action: 'payment.method.change',
            category: SENSITIVE_ACTION_CATEGORIES.PAYMENT_PAYOUT_CHANGE,
            riskLevel: RISK_LEVELS.HIGH,
            resourceType: 'payment_method',
        };
    }

    if (path.startsWith('/api/uploads/') || path.includes('/reviews/upload')) {
        return {
            action: 'upload.write',
            category: SENSITIVE_ACTION_CATEGORIES.UPLOAD_WRITE,
            riskLevel: RISK_LEVELS.MEDIUM,
            resourceType: 'upload',
        };
    }

    if (path.startsWith('/api/products/') && path.endsWith('/reviews')) {
        return {
            action: 'moderation.review.write',
            category: SENSITIVE_ACTION_CATEGORIES.UPLOAD_WRITE,
            riskLevel: RISK_LEVELS.MEDIUM,
            resourceType: 'review',
        };
    }

    if (path.startsWith('/api/orders/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        return {
            action: 'order.status.change',
            category: SENSITIVE_ACTION_CATEGORIES.ORDER_STATUS_CHANGE,
            riskLevel: RISK_LEVELS.HIGH,
            resourceType: 'order',
        };
    }

    if (path.startsWith('/api/auth/recovery') || path.startsWith('/api/auth/password')) {
        return {
            action: 'auth.recovery.change',
            category: SENSITIVE_ACTION_CATEGORIES.ACCOUNT_RECOVERY_CHANGE,
            riskLevel: RISK_LEVELS.CRITICAL,
            resourceType: 'auth',
        };
    }

    if (path.startsWith('/api/users/account')) {
        return {
            action: 'data.delete.request',
            category: SENSITIVE_ACTION_CATEGORIES.DATA_DELETE,
            riskLevel: RISK_LEVELS.CRITICAL,
            resourceType: 'user_account',
        };
    }

    if (path.startsWith('/api/ai/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        return {
            action: 'ai.tool.action',
            category: SENSITIVE_ACTION_CATEGORIES.AI_TOOL_ACTION,
            riskLevel: RISK_LEVELS.MEDIUM,
            resourceType: 'ai',
        };
    }

    return null;
};

const getCategoryPolicy = (category, config = resolveSensitiveActionPolicyConfig(), actor = {}) => {
    const requiredAssurance = ['authenticated'];
    const adminActor = hasAdminRole(actor);

    if (ADMIN_CATEGORIES.has(category) || (adminActor && ADMIN_PAYMENT_CATEGORIES.has(category))) {
        requiredAssurance.push('admin');
    }

    if ([
        SENSITIVE_ACTION_CATEGORIES.ADMIN_STATE_CHANGE,
        SENSITIVE_ACTION_CATEGORIES.ADMIN_USER_MANAGEMENT,
        SENSITIVE_ACTION_CATEGORIES.PAYMENT_REFUND,
        SENSITIVE_ACTION_CATEGORIES.PAYMENT_PAYOUT_CHANGE,
        SENSITIVE_ACTION_CATEGORIES.ACCOUNT_RECOVERY_CHANGE,
        SENSITIVE_ACTION_CATEGORIES.PASSWORD_OR_AUTH_FACTOR_CHANGE,
        SENSITIVE_ACTION_CATEGORIES.DATA_DELETE,
    ].includes(category)) {
        requiredAssurance.push('recent_auth');
    }

    if ([
        SENSITIVE_ACTION_CATEGORIES.ADMIN_STATE_CHANGE,
        SENSITIVE_ACTION_CATEGORIES.ADMIN_USER_MANAGEMENT,
    ].includes(category) && config.requireWebAuthnForAdminStateChanges) {
        requiredAssurance.push('webauthn_registered', 'fresh_webauthn_step_up');
    }

    if (adminActor && [
        SENSITIVE_ACTION_CATEGORIES.PAYMENT_REFUND,
        SENSITIVE_ACTION_CATEGORIES.PAYMENT_PAYOUT_CHANGE,
    ].includes(category) && config.requireWebAuthnForAdminStateChanges) {
        requiredAssurance.push('webauthn_registered', 'fresh_webauthn_step_up');
    }

    if (category === SENSITIVE_ACTION_CATEGORIES.ADMIN_SECURITY_CONFIG_CHANGE
        && config.requireWebAuthnForAdminSecurityChanges) {
        requiredAssurance.push('webauthn_registered', 'fresh_webauthn_step_up');
    }

    return {
        requiredAssurance,
        failClosedInProduction: [
            SENSITIVE_ACTION_CATEGORIES.ADMIN_USER_MANAGEMENT,
            SENSITIVE_ACTION_CATEGORIES.ADMIN_SECURITY_CONFIG_CHANGE,
            SENSITIVE_ACTION_CATEGORIES.PAYMENT_REFUND,
            SENSITIVE_ACTION_CATEGORIES.PAYMENT_PAYOUT_CHANGE,
            SENSITIVE_ACTION_CATEGORIES.ACCOUNT_RECOVERY_CHANGE,
            SENSITIVE_ACTION_CATEGORIES.DATA_DELETE,
        ].includes(category),
    };
};

module.exports = {
    SENSITIVE_ACTION_CATEGORIES,
    RISK_LEVELS,
    classifySensitiveActionFromRequest,
    getCategoryPolicy,
    hasAdminRole,
    isProductionEnv,
    parseBooleanEnv,
    parsePositiveIntEnv,
    resolveSensitiveActionPolicyConfig,
};
