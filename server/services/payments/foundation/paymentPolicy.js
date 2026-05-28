const normalizeRoles = (principal) => new Set([...(principal?.roles || []), ...(principal?.permissions || [])]);

const ownsResource = ({ principal, resource }) => {
    const userId = String(principal?.userId || '');
    return Boolean(userId) && [resource?.userId, resource?.customerId, resource?.ownerId].some((value) => String(value || '') === userId);
};

const hasRole = (principal, role) => normalizeRoles(principal).has(role);

const requiresApproval = ({ amountMinor, highValueRefundMinor = 500000 }) => Number(amountMinor || 0) >= highValueRefundMinor;

const evaluatePaymentPolicy = (action, context = {}) => {
    const { principal, resource = {}, input = {} } = context;

    if (action === 'payment:create') {
        return Object.freeze({
            allowed: ownsResource({ principal, resource }),
            reason: ownsResource({ principal, resource }) ? 'owner_can_create_payment' : 'owner_required',
        });
    }

    if (action === 'payment:read') {
        const allowed = ownsResource({ principal, resource }) || hasRole(principal, 'admin') || hasRole(principal, 'payment:read');
        return Object.freeze({ allowed, reason: allowed ? 'read_allowed' : 'read_denied' });
    }

    if (action === 'payment:refund') {
        const canRefund = hasRole(principal, 'admin') || hasRole(principal, 'payment:refund');
        const approvalRequired = requiresApproval(input);
        const approved = Boolean(input.approvedBy);
        const allowed = canRefund && (!approvalRequired || approved);
        return Object.freeze({
            allowed,
            approvalRequired,
            reason: allowed ? 'refund_allowed' : approvalRequired && !approved ? 'high_value_refund_requires_approval' : 'refund_permission_required',
        });
    }

    if (action === 'payment:provider_metadata:read') {
        const allowed = hasRole(principal, 'admin') || hasRole(principal, 'payment:sensitive_metadata:read');
        return Object.freeze({
            allowed,
            reason: allowed ? 'sensitive_metadata_allowed' : 'sensitive_metadata_denied',
        });
    }

    if (action === 'payment:webhook') {
        return Object.freeze({
            allowed: Boolean(context.signatureVerified),
            reason: context.signatureVerified ? 'webhook_signature_verified' : 'webhook_signature_required',
        });
    }

    return Object.freeze({ allowed: false, reason: 'unknown_action' });
};

module.exports = {
    evaluatePaymentPolicy,
    ownsResource,
    hasRole,
};
