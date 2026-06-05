const paymentPolicies = Object.freeze({
    'payment.webhook.process': {
        action: 'payment.webhook.process',
        resourceType: 'payment_webhook',
        allowedRoles: ['payment_webhook', 'system'],
        requiresIdentity: false,
        requiresOwnership: false,
        tenantRequired: false,
        sensitive: true,
        stepUp: null,
        audit: true,
        riskThreshold: 60,
        requireIdempotency: true,
        protectedCriticalRisk: true,
        riskyWrite: true,
    },
    'payment.refund.create': {
        action: 'payment.refund.create',
        resourceType: 'payment',
        allowedRoles: ['buyer', 'admin', 'super_admin'],
        requiresIdentity: true,
        requiresOwnership: true,
        adminBypassesOwnership: true,
        tenantRequired: false,
        sensitive: true,
        stepUp: 'MFA',
        audit: true,
        riskThreshold: 60,
        requireIdempotency: true,
        highValue: true,
        riskyWrite: true,
    },
});

module.exports = {
    paymentPolicies,
};
