const { SECURITY_DECISIONS } = require('./securityDecision');

const SENSITIVITY_LEVELS = Object.freeze({
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
});

const REQUIRED_FIELDS = Object.freeze([
    'action',
    'sensitivity',
    'requiresAuth',
    'requiresTenant',
    'requiresFreshMfa',
    'requiresTrustedDevice',
    'requiresAudit',
    'defaultDecision',
    'description',
]);

const registryEntry = (action, sensitivity, overrides = {}) => Object.freeze({
    action,
    sensitivity,
    requiresAuth: true,
    requiresTenant: false,
    requiresFreshMfa: false,
    requiresTrustedDevice: false,
    requiresAudit: sensitivity !== SENSITIVITY_LEVELS.LOW,
    defaultDecision: sensitivity === SENSITIVITY_LEVELS.LOW
        ? SECURITY_DECISIONS.ALLOW
        : SECURITY_DECISIONS.AUDIT,
    description: action,
    ...overrides,
});

const ACTION_SENSITIVITY_REGISTRY = Object.freeze([
    registryEntry('auth.login', SENSITIVITY_LEVELS.LOW, {
        requiresAuth: false,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.AUDIT,
        description: 'User login attempt.',
    }),
    registryEntry('auth.logout', SENSITIVITY_LEVELS.LOW, {
        requiresAudit: true,
        description: 'User logout or session close.',
    }),
    registryEntry('auth.mfa.disable', SENSITIVITY_LEVELS.CRITICAL, {
        requiresFreshMfa: true,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.STEP_UP,
        description: 'Disable a multi-factor authentication method.',
    }),
    registryEntry('auth.trustedDevice.add', SENSITIVITY_LEVELS.HIGH, {
        requiresFreshMfa: true,
        requiresTrustedDevice: false,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.STEP_UP,
        description: 'Enroll a trusted device.',
    }),
    registryEntry('auth.password.reset', SENSITIVITY_LEVELS.HIGH, {
        requiresAuth: false,
        requiresFreshMfa: false,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.AUDIT,
        description: 'Reset account password through recovery flow.',
    }),
    registryEntry('auth.session.revoke', SENSITIVITY_LEVELS.HIGH, {
        requiresAudit: true,
        description: 'Revoke an active session.',
    }),

    registryEntry('admin.user.read', SENSITIVITY_LEVELS.MEDIUM, {
        requiresAudit: true,
        description: 'Read admin-visible user data.',
    }),
    registryEntry('admin.user.update', SENSITIVITY_LEVELS.HIGH, {
        requiresFreshMfa: true,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.STEP_UP,
        description: 'Mutate user state from the admin console.',
    }),
    registryEntry('admin.user.delete', SENSITIVITY_LEVELS.CRITICAL, {
        requiresFreshMfa: true,
        requiresTrustedDevice: true,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.STEP_UP,
        description: 'Delete or irreversibly disable a user.',
    }),
    registryEntry('admin.user.role.update', SENSITIVITY_LEVELS.CRITICAL, {
        requiresFreshMfa: true,
        requiresTrustedDevice: true,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.STEP_UP,
        description: 'Change administrative privileges.',
    }),
    registryEntry('admin.security.config.update', SENSITIVITY_LEVELS.CRITICAL, {
        requiresFreshMfa: true,
        requiresTrustedDevice: true,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.STEP_UP,
        description: 'Change security configuration.',
    }),
    registryEntry('admin.audit.export', SENSITIVITY_LEVELS.HIGH, {
        requiresFreshMfa: true,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.STEP_UP,
        description: 'Export audit or analytics data.',
    }),
    registryEntry('admin.status.incident.create', SENSITIVITY_LEVELS.CRITICAL, {
        requiresFreshMfa: true,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.STEP_UP,
        description: 'Create a public status incident.',
    }),
    registryEntry('admin.status.incident.update', SENSITIVITY_LEVELS.CRITICAL, {
        requiresFreshMfa: true,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.STEP_UP,
        description: 'Update a public status incident.',
    }),
    registryEntry('admin.status.component.update', SENSITIVITY_LEVELS.HIGH, {
        requiresFreshMfa: true,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.STEP_UP,
        description: 'Change public status component state.',
    }),

    registryEntry('payment.checkout.create', SENSITIVITY_LEVELS.HIGH, {
        requiresAudit: true,
        description: 'Create or confirm checkout payment intent.',
    }),
    registryEntry('payment.webhook.process', SENSITIVITY_LEVELS.CRITICAL, {
        requiresAuth: false,
        requiresFreshMfa: false,
        requiresTrustedDevice: false,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.AUDIT,
        freshMfaExceptionReason: 'Payment webhooks are machine-authenticated by provider signature verification.',
        description: 'Process a signed payment provider webhook.',
    }),
    registryEntry('payment.refund.create', SENSITIVITY_LEVELS.CRITICAL, {
        requiresFreshMfa: true,
        requiresTrustedDevice: true,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.STEP_UP,
        description: 'Create a payment refund request.',
    }),
    registryEntry('payment.refund.approve', SENSITIVITY_LEVELS.CRITICAL, {
        requiresFreshMfa: true,
        requiresTrustedDevice: true,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.STEP_UP,
        description: 'Approve or mutate refund ledger state.',
    }),
    registryEntry('payment.payout.update', SENSITIVITY_LEVELS.CRITICAL, {
        requiresFreshMfa: true,
        requiresTrustedDevice: true,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.STEP_UP,
        description: 'Capture, retry, expire, or update payment payout state.',
    }),

    registryEntry('upload.avatar.create', SENSITIVITY_LEVELS.MEDIUM, {
        requiresAudit: true,
        description: 'Create avatar upload media.',
    }),
    registryEntry('upload.productImage.create', SENSITIVITY_LEVELS.MEDIUM, {
        requiresAudit: true,
        description: 'Create product image upload media.',
    }),
    registryEntry('upload.reviewMedia.create', SENSITIVITY_LEVELS.MEDIUM, {
        requiresAudit: true,
        description: 'Create review media upload.',
    }),
    registryEntry('upload.aiMedia.create', SENSITIVITY_LEVELS.HIGH, {
        requiresAudit: true,
        description: 'Create AI-generated or AI-processed media upload.',
    }),

    registryEntry('data.export', SENSITIVITY_LEVELS.HIGH, {
        requiresFreshMfa: true,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.STEP_UP,
        description: 'Export tenant, account, audit, or analytics data.',
    }),
    registryEntry('data.delete', SENSITIVITY_LEVELS.CRITICAL, {
        requiresFreshMfa: true,
        requiresTrustedDevice: true,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.STEP_UP,
        description: 'Delete durable data.',
    }),
    registryEntry('tenant.resource.read', SENSITIVITY_LEVELS.MEDIUM, {
        requiresTenant: true,
        requiresAudit: true,
        description: 'Read tenant-scoped resource.',
    }),
    registryEntry('tenant.resource.write', SENSITIVITY_LEVELS.HIGH, {
        requiresTenant: true,
        requiresFreshMfa: false,
        requiresAudit: true,
        description: 'Write tenant-scoped resource.',
    }),

    registryEntry('ai.chat.create', SENSITIVITY_LEVELS.MEDIUM, {
        requiresAuth: false,
        requiresAudit: true,
        description: 'Create an AI chat request.',
    }),
    registryEntry('ai.tool.execute', SENSITIVITY_LEVELS.CRITICAL, {
        requiresFreshMfa: true,
        requiresAudit: true,
        defaultDecision: SECURITY_DECISIONS.STEP_UP,
        description: 'Execute a mutating AI tool call.',
    }),
    registryEntry('ai.media.process', SENSITIVITY_LEVELS.HIGH, {
        requiresAudit: true,
        description: 'Process media through AI features.',
    }),
]);

const REGISTRY_BY_ACTION = Object.freeze(
    ACTION_SENSITIVITY_REGISTRY.reduce((acc, item) => {
        acc[item.action] = item;
        return acc;
    }, {})
);

const isAdminPaymentSecurityOrDataAction = (action = '') => /^(admin|payment|data)\./.test(action)
    || action.includes('.security.');

const validateActionRegistry = (registry = ACTION_SENSITIVITY_REGISTRY) => {
    const errors = [];
    const seen = new Set();

    registry.forEach((item, index) => {
        REQUIRED_FIELDS.forEach((field) => {
            if (!Object.prototype.hasOwnProperty.call(item, field)) {
                errors.push(`${item.action || `index:${index}`}: missing ${field}`);
            }
        });

        if (seen.has(item.action)) {
            errors.push(`${item.action}: duplicate action`);
        }
        seen.add(item.action);

        if (!Object.values(SENSITIVITY_LEVELS).includes(item.sensitivity)) {
            errors.push(`${item.action}: invalid sensitivity`);
        }

        if (isAdminPaymentSecurityOrDataAction(item.action) && item.requiresAudit !== true) {
            errors.push(`${item.action}: sensitive action must require audit`);
        }

        if (
            item.sensitivity === SENSITIVITY_LEVELS.CRITICAL
            && item.requiresFreshMfa !== true
            && !item.freshMfaExceptionReason
        ) {
            errors.push(`${item.action}: critical action requires fresh MFA or documented exception`);
        }
    });

    return errors;
};

const getActionDefinition = (action = '') => REGISTRY_BY_ACTION[String(action || '').trim()] || null;

module.exports = {
    ACTION_SENSITIVITY_REGISTRY,
    REGISTRY_BY_ACTION,
    REQUIRED_FIELDS,
    SENSITIVITY_LEVELS,
    getActionDefinition,
    validateActionRegistry,
};
