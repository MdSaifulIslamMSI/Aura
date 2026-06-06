const { adminPolicies } = require('./adminPolicies');
const { aiPolicies } = require('./aiPolicies');
const { orderPolicies } = require('./orderPolicies');
const { paymentPolicies } = require('./paymentPolicies');
const { uploadPolicies } = require('./uploadPolicies');
const { userPolicies } = require('./userPolicies');

const actionRegistry = Object.freeze({
    ...orderPolicies,
    ...adminPolicies,
    ...paymentPolicies,
    ...uploadPolicies,
    ...aiPolicies,
    ...userPolicies,
});

const normalizeAction = (action = '') => String(action || '').trim();

const getActionPolicy = (action = '') => {
    const normalized = normalizeAction(action);
    return actionRegistry[normalized] || {
        action: normalized,
        resourceType: 'unknown',
        allowedRoles: ['admin', 'super_admin'],
        requiresIdentity: true,
        requiresOwnership: false,
        tenantRequired: false,
        sensitive: true,
        stepUp: 'MFA',
        audit: true,
        riskThreshold: 60,
        riskyWrite: true,
        unknownAction: true,
    };
};

const listActionPolicies = () => Object.values(actionRegistry);

module.exports = {
    actionRegistry,
    getActionPolicy,
    listActionPolicies,
};
