const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { requireSecurityDecision } = require('../middleware/requireSecurityDecision');
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

const auditStatusComponentUpdate = requireSecurityDecision('admin.status.component.update', {
    resourceType: 'status_component',
    resourceIdParam: 'id',
});
const auditStatusIncidentCreate = requireSecurityDecision('admin.status.incident.create', {
    resourceType: 'status_incident',
});
const auditStatusIncidentUpdate = requireSecurityDecision('admin.status.incident.update', {
    resourceType: 'status_incident',
    resourceIdParam: 'id',
});

router.use(protect, admin);

router.get('/', getAdminStatusController);
router.post('/components', validate(adminStatusComponentCreateSchema), auditStatusComponentUpdate, sensitiveActions.adminSecurityConfigChange, createAdminStatusComponentController);
router.patch('/components/:id', validate(adminStatusComponentUpdateSchema), auditStatusComponentUpdate, sensitiveActions.adminSecurityConfigChange, updateAdminStatusComponentController);
router.post('/incidents', validate(adminStatusIncidentCreateSchema), auditStatusIncidentCreate, sensitiveActions.adminSecurityConfigChange, createAdminStatusIncidentController);
router.patch('/incidents/:id', validate(adminStatusIncidentUpdateSchema), auditStatusIncidentUpdate, sensitiveActions.adminSecurityConfigChange, updateAdminStatusIncidentController);
router.post('/incidents/:id/updates', validate(adminStatusIncidentTimelineSchema), auditStatusIncidentUpdate, sensitiveActions.adminSecurityConfigChange, addAdminStatusIncidentUpdateController);
router.post('/incidents/:id/resolve', validate(adminStatusIncidentResolveSchema), auditStatusIncidentUpdate, sensitiveActions.adminSecurityConfigChange, resolveAdminStatusIncidentController);
router.post('/incidents/:id/postmortem', validate(adminStatusIncidentPostmortemSchema), auditStatusIncidentUpdate, sensitiveActions.adminSecurityConfigChange, generateAdminStatusPostmortemController);
router.post('/maintenance', validate(adminStatusMaintenanceCreateSchema), sensitiveActions.adminSecurityConfigChange, createAdminStatusMaintenanceController);
router.get('/subscribers', listAdminStatusSubscribersController);
router.get('/checks', validate(adminStatusChecksSchema), listAdminStatusChecksController);
router.post('/monitor/run', sensitiveActions.adminSecurityConfigChange, runAdminStatusMonitorController);
router.post('/seed', sensitiveActions.adminSecurityConfigChange, seedAdminStatusController);

module.exports = router;
