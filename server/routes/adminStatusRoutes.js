const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const { requireTrustDecision } = require('../trust/middleware/requireTrustDecision');
const {
    addAdminStatusIncidentUpdateController,
    createAdminStatusComponentController,
    createAdminStatusIncidentController,
    createAdminStatusMaintenanceController,
    generateAdminStatusPostmortemController,
    getAdminStatusController,
    listAdminStatusChecksController,
    listAdminStatusSubscribersController,
    resolveAdminStatusIncidentController,
    runAdminStatusMonitorController,
    seedAdminStatusController,
    updateAdminStatusComponentController,
    updateAdminStatusIncidentController,
} = require('../controllers/statusController');
const {
    adminStatusChecksSchema,
    adminStatusComponentCreateSchema,
    adminStatusComponentUpdateSchema,
    adminStatusIncidentCreateSchema,
    adminStatusIncidentPostmortemSchema,
    adminStatusIncidentResolveSchema,
    adminStatusIncidentTimelineSchema,
    adminStatusIncidentUpdateSchema,
    adminStatusMaintenanceCreateSchema,
} = require('../validators/statusValidators');

const router = express.Router();

router.use(protect, admin);

router.get('/', getAdminStatusController);
router.post('/components', validate(adminStatusComponentCreateSchema), requireTrustDecision('admin.status.write'), sensitiveActions.adminSecurityConfigChange, createAdminStatusComponentController);
router.patch('/components/:id', validate(adminStatusComponentUpdateSchema), requireTrustDecision('admin.status.write'), sensitiveActions.adminSecurityConfigChange, updateAdminStatusComponentController);
router.post('/incidents', validate(adminStatusIncidentCreateSchema), requireTrustDecision('admin.status.write'), sensitiveActions.adminSecurityConfigChange, createAdminStatusIncidentController);
router.patch('/incidents/:id', validate(adminStatusIncidentUpdateSchema), requireTrustDecision('admin.status.write'), sensitiveActions.adminSecurityConfigChange, updateAdminStatusIncidentController);
router.post('/incidents/:id/updates', validate(adminStatusIncidentTimelineSchema), requireTrustDecision('admin.status.write'), sensitiveActions.adminSecurityConfigChange, addAdminStatusIncidentUpdateController);
router.post('/incidents/:id/resolve', validate(adminStatusIncidentResolveSchema), requireTrustDecision('admin.status.write'), sensitiveActions.adminSecurityConfigChange, resolveAdminStatusIncidentController);
router.post('/incidents/:id/postmortem', validate(adminStatusIncidentPostmortemSchema), requireTrustDecision('admin.status.write'), sensitiveActions.adminSecurityConfigChange, generateAdminStatusPostmortemController);
router.post('/maintenance', validate(adminStatusMaintenanceCreateSchema), requireTrustDecision('admin.status.write'), sensitiveActions.adminSecurityConfigChange, createAdminStatusMaintenanceController);
router.get('/subscribers', listAdminStatusSubscribersController);
router.get('/checks', validate(adminStatusChecksSchema), listAdminStatusChecksController);
router.post('/monitor/run', requireTrustDecision('admin.status.write'), sensitiveActions.adminSecurityConfigChange, runAdminStatusMonitorController);
router.post('/seed', requireTrustDecision('admin.status.write'), sensitiveActions.adminSecurityConfigChange, seedAdminStatusController);

module.exports = router;
