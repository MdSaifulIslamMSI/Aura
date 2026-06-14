const { getLoginRuntimeEnforcementPolicy } = require('./loginRuntimeEnforcementPolicy');

const PRIVILEGED_ACCESS_POLICY = {
    jitAccessEnabled: false,
    defaultGrantTtlMinutes: 30,
    approvalRequiredFor: [
        'admin.users.delete',
        'admin.products.delete',
        'admin.ops.maintenance',
        'admin.payments.capture',
        'admin.payments.expire_stale',
        'admin.payments.refunds.write',
    ],
    baselineAssurance: [
        'admin_allowlist',
        'verified_email',
        'fresh_session',
        'second_factor',
        'passkey_when_configured',
    ],
    auditEvents: [
        'privileged_access.requested',
        'privileged_access.approved',
        'privileged_access.denied',
        'privileged_access.expired',
        'privileged_action.executed',
    ],
};

const getPrivilegedAccessPolicy = () => {
    const runtimePolicy = getLoginRuntimeEnforcementPolicy();

    return {
        ...PRIVILEGED_ACCESS_POLICY,
        jitAccessEnabled: runtimePolicy.privilegedJitAccessEnabled,
        approvalRequiredFor: [...PRIVILEGED_ACCESS_POLICY.approvalRequiredFor],
        baselineAssurance: [...PRIVILEGED_ACCESS_POLICY.baselineAssurance],
        auditEvents: [...PRIVILEGED_ACCESS_POLICY.auditEvents],
    };
};

module.exports = {
    PRIVILEGED_ACCESS_POLICY,
    getPrivilegedAccessPolicy,
};
