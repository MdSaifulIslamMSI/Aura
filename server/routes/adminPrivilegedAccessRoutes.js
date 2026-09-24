const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { buildRateLimitKey } = require('../services/adminRecoveryGrantService');
const { requireTrustDecision } = require('../trust/middleware/requireTrustDecision');
const {
    requestPrivilegedAccess,
    listPrivilegedAccessGrants,
    approvePrivilegedAccessGrant,
    denyPrivilegedAccessGrant,
    revokePrivilegedAccessGrant,
} = require('../controllers/privilegedAccessController');
const {
    privilegedGrantListSchema,
    privilegedGrantRequestSchema,
    privilegedGrantIdSchema,
    privilegedGrantDenySchema,
} = require('../validators/privilegedAccessValidators');

const router = express.Router();

const privilegedAccessLimiter = createDistributedRateLimit({
    name: 'admin_privileged_access',
    windowMs: 5 * 60 * 1000,
    max: 10,
    securityCritical: true,
    keyGenerator: (req) => buildRateLimitKey('privileged_access', req),
    message: {
        success: false,
        code: 'ADMIN_PRIVILEGED_ACCESS_RATE_LIMITED',
        message: 'Too many privileged access actions. Wait before trying again.',
    },
});

router.get('/grants', protect, admin, privilegedAccessLimiter, validate(privilegedGrantListSchema), listPrivilegedAccessGrants);
router.post('/grants', protect, admin, privilegedAccessLimiter, validate(privilegedGrantRequestSchema), requireTrustDecision('admin.privileged.access'), sensitiveActions.adminSecurityConfigChange, requestPrivilegedAccess);
router.post('/grants/:grantId/approve', protect, admin, privilegedAccessLimiter, validate(privilegedGrantIdSchema), requireTrustDecision('admin.security.setting.update'), sensitiveActions.adminSecurityConfigChange, approvePrivilegedAccessGrant);
router.post('/grants/:grantId/deny', protect, admin, privilegedAccessLimiter, validate(privilegedGrantDenySchema), requireTrustDecision('admin.security.setting.update'), sensitiveActions.adminSecurityConfigChange, denyPrivilegedAccessGrant);
router.post('/grants/:grantId/revoke', protect, admin, privilegedAccessLimiter, validate(privilegedGrantIdSchema), requireTrustDecision('admin.security.setting.update'), sensitiveActions.adminSecurityConfigChange, revokePrivilegedAccessGrant);

module.exports = router;
