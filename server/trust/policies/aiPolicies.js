const aiPolicies = Object.freeze({
    'ai.chat.invoke': {
        action: 'ai.chat.invoke',
        resourceType: 'ai_session',
        allowedRoles: ['anonymous', 'buyer', 'seller', 'admin', 'super_admin'],
        requiresIdentity: false,
        requiresOwnership: false,
        tenantRequired: false,
        sensitive: false,
        stepUp: null,
        audit: true,
        riskThreshold: 60,
        protectedCriticalRisk: true,
        riskyWrite: false,
    },
    'ai.media.analyze': {
        action: 'ai.media.analyze',
        resourceType: 'ai_media',
        allowedRoles: ['buyer', 'seller', 'admin', 'super_admin'],
        requiresIdentity: true,
        requiresOwnership: true,
        tenantRequired: false,
        sensitive: true,
        stepUp: null,
        audit: true,
        riskThreshold: 60,
        protectedCriticalRisk: true,
        riskyWrite: true,
    },
});

module.exports = {
    aiPolicies,
};
