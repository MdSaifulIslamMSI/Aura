const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
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

router.get('/readiness', protect, admin, validate(adminOpsReadinessSchema), getAdminOpsReadiness);
router.get('/client-diagnostics', protect, admin, validate(adminClientDiagnosticsSchema), getAdminClientDiagnostics);
router.get('/aws-control', protect, admin, validate(adminOpsAwsControlSchema), getAdminAwsControl);
router.post('/smoke', protect, admin, validate(adminOpsSmokeSchema), sensitiveActions.adminSecurityConfigChange, runAdminOpsSmoke);
router.post('/maintenance', protect, admin, validate(adminOpsMaintenanceSchema), sensitiveActions.adminSecurityConfigChange, runAdminOpsMaintenance);
router.post('/aws-control/actions', protect, admin, validate(adminOpsAwsControlActionSchema), sensitiveActions.adminSecurityConfigChange, runAdminAwsControlAction);

module.exports = router;
