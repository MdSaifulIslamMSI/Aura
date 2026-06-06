const uploadPolicies = Object.freeze({
    'upload.create': {
        action: 'upload.create',
        resourceType: 'upload',
        allowedRoles: ['buyer', 'seller', 'admin', 'super_admin'],
        requiresIdentity: true,
        requiresOwnership: true,
        tenantRequired: false,
        sensitive: true,
        stepUp: null,
        audit: true,
        riskThreshold: 60,
        riskyWrite: true,
    },
    'upload.approve': {
        action: 'upload.approve',
        resourceType: 'upload',
        allowedRoles: ['admin', 'super_admin'],
        requiresIdentity: true,
        requiresOwnership: false,
        tenantRequired: false,
        sensitive: true,
        stepUp: 'MFA',
        audit: true,
        riskThreshold: 60,
        allowedStates: ['quarantined', 'scan_clean', 'pending_review'],
        denyStates: ['malware_detected', 'blocked'],
        riskyWrite: true,
    },
});

module.exports = {
    uploadPolicies,
};
