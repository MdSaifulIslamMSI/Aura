const { evaluateSecurityPolicy } = require('./securityPolicyEngine');

const evaluateSensitiveActionSecurity = ({
    req = {},
    action = '',
    resource = {},
    config,
    signals = {},
} = {}) => evaluateSecurityPolicy({
    req,
    action,
    resource,
    config,
    signals,
    forceAuditRequired: true,
});

module.exports = {
    evaluateSensitiveActionSecurity,
};
