const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
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
router.post('/components', validate(adminStatusComponentCreateSchema), sensitiveActions.adminSecurityConfigChange, createAdminStatusComponentController);
router.patch('/components/:id', validate(adminStatusComponentUpdateSchema), sensitiveActions.adminSecurityConfigChange, updateAdminStatusComponentController);
router.post('/incidents', validate(adminStatusIncidentCreateSchema), sensitiveActions.adminSecurityConfigChange, createAdminStatusIncidentController);
router.patch('/incidents/:id', validate(adminStatusIncidentUpdateSchema), sensitiveActions.adminSecurityConfigChange, updateAdminStatusIncidentController);
router.post('/incidents/:id/updates', validate(adminStatusIncidentTimelineSchema), sensitiveActions.adminSecurityConfigChange, addAdminStatusIncidentUpdateController);
router.post('/incidents/:id/resolve', validate(adminStatusIncidentResolveSchema), sensitiveActions.adminSecurityConfigChange, resolveAdminStatusIncidentController);
router.post('/incidents/:id/postmortem', validate(adminStatusIncidentPostmortemSchema), sensitiveActions.adminSecurityConfigChange, generateAdminStatusPostmortemController);
router.post('/maintenance', validate(adminStatusMaintenanceCreateSchema), sensitiveActions.adminSecurityConfigChange, createAdminStatusMaintenanceController);
router.get('/subscribers', listAdminStatusSubscribersController);
router.get('/checks', validate(adminStatusChecksSchema), listAdminStatusChecksController);
router.post('/monitor/run', sensitiveActions.adminSecurityConfigChange, runAdminStatusMonitorController);
router.post('/seed', sensitiveActions.adminSecurityConfigChange, seedAdminStatusController);

module.exports = router;
