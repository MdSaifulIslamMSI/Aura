const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { requireTrustDecision } = require('../trust/middleware/requireTrustDecision');
const { buildRateLimitKey } = require('../services/adminRecoveryGrantService');
const {
    getAdminClientDiagnostics,
    getAdminAwsControl,
    getAdminOpsReadiness,
    runAdminAwsControlAction,
    runAdminOpsSmoke,
    runAdminOpsMaintenance,
} = require('../controllers/adminOpsController');
const {
    adminClientDiagnosticsSchema,
    adminOpsAwsControlActionSchema,
    adminOpsAwsControlSchema,
    adminOpsReadinessSchema,
    adminOpsSmokeSchema,
    adminOpsMaintenanceSchema,
} = require('../validators/adminOpsValidators');

const router = express.Router();

const awsControlActionLimiter = createDistributedRateLimit({
    name: 'admin_ops_aws_control_action',
    windowMs: 5 * 60 * 1000,
    max: 20,
    securityCritical: true,
    keyGenerator: (req) => buildRateLimitKey('admin_ops_aws_control_action', req),
    message: {
        success: false,
        code: 'ADMIN_AWS_CONTROL_RATE_LIMITED',
        message: 'Too many AWS control actions. Wait before trying again.',
    },
});

router.get('/readiness', protect, admin, validate(adminOpsReadinessSchema), getAdminOpsReadiness);
router.get('/client-diagnostics', protect, admin, validate(adminClientDiagnosticsSchema), getAdminClientDiagnostics);
router.get('/aws-control', protect, admin, validate(adminOpsAwsControlSchema), getAdminAwsControl);
router.post('/smoke', protect, admin, validate(adminOpsSmokeSchema), requireTrustDecision('admin.ops.write'), sensitiveActions.adminSecurityConfigChange, runAdminOpsSmoke);
router.post('/maintenance', protect, admin, validate(adminOpsMaintenanceSchema), requireTrustDecision('admin.ops.write'), sensitiveActions.adminSecurityConfigChange, runAdminOpsMaintenance);
router.post('/aws-control/actions', protect, admin, awsControlActionLimiter, validate(adminOpsAwsControlActionSchema), requireTrustDecision('admin.ops.write'), sensitiveActions.adminSecurityConfigChange, runAdminAwsControlAction);

module.exports = router;
