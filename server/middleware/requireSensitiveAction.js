const { requireSecurityDecision } = require('./requireSecurityDecision');

const requireSensitiveAction = (action, options = {}) => requireSecurityDecision(action, {
    ...options,
    forceAuditRequired: true,
});

module.exports = {
    requireSensitiveAction,
};
