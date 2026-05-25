const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
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
router.post('/components', validate(adminStatusComponentCreateSchema), createAdminStatusComponentController);
router.patch('/components/:id', validate(adminStatusComponentUpdateSchema), updateAdminStatusComponentController);
router.post('/incidents', validate(adminStatusIncidentCreateSchema), createAdminStatusIncidentController);
router.patch('/incidents/:id', validate(adminStatusIncidentUpdateSchema), updateAdminStatusIncidentController);
router.post('/incidents/:id/updates', validate(adminStatusIncidentTimelineSchema), addAdminStatusIncidentUpdateController);
router.post('/incidents/:id/resolve', validate(adminStatusIncidentResolveSchema), resolveAdminStatusIncidentController);
router.post('/incidents/:id/postmortem', validate(adminStatusIncidentPostmortemSchema), generateAdminStatusPostmortemController);
router.post('/maintenance', validate(adminStatusMaintenanceCreateSchema), createAdminStatusMaintenanceController);
router.get('/subscribers', listAdminStatusSubscribersController);
router.get('/checks', validate(adminStatusChecksSchema), listAdminStatusChecksController);
router.post('/monitor/run', runAdminStatusMonitorController);
router.post('/seed', seedAdminStatusController);

module.exports = router;
