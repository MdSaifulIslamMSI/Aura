const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const {
    getAdminClientDiagnostics,
    getAdminOpsReadiness,
    runAdminOpsSmoke,
    runAdminOpsMaintenance,
} = require('../controllers/adminOpsController');
const {
    adminClientDiagnosticsSchema,
    adminOpsReadinessSchema,
    adminOpsSmokeSchema,
    adminOpsMaintenanceSchema,
} = require('../validators/adminOpsValidators');

const router = express.Router();

router.get('/readiness', protect, admin, validate(adminOpsReadinessSchema), getAdminOpsReadiness);
router.get('/client-diagnostics', protect, admin, validate(adminClientDiagnosticsSchema), getAdminClientDiagnostics);
router.post('/smoke', protect, admin, validate(adminOpsSmokeSchema), sensitiveActions.adminSecurityConfigChange, runAdminOpsSmoke);
router.post('/maintenance', protect, admin, validate(adminOpsMaintenanceSchema), sensitiveActions.adminSecurityConfigChange, runAdminOpsMaintenance);

module.exports = router;
