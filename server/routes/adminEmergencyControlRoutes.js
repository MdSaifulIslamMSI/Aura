const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const {
    requireEmergencyControlRole,
    requireEmergencySecondFactor,
} = require('../middleware/emergencyAdminMiddleware');
const {
    activateEmergencyControl,
    deactivateEmergencyControl,
    extendEmergencyControl,
    listEmergencyAuditLogs,
    listEmergencyControls,
    updateEmergencyControlMessage,
} = require('../controllers/emergencyControlController');
const {
    activateEmergencyFlagSchema,
    deactivateEmergencyFlagSchema,
    extendEmergencyFlagSchema,
    listEmergencyAuditSchema,
    updateEmergencyMessageSchema,
} = require('../validators/emergencyControlValidators');

const router = express.Router();

router.use(protect, admin, requireEmergencyControlRole);

router.get('/', listEmergencyControls);
router.get('/audit', validate(listEmergencyAuditSchema), listEmergencyAuditLogs);
router.post('/:key/activate', requireEmergencySecondFactor, validate(activateEmergencyFlagSchema), sensitiveActions.adminSecurityConfigChange, activateEmergencyControl);
router.post('/:key/deactivate', requireEmergencySecondFactor, validate(deactivateEmergencyFlagSchema), sensitiveActions.adminSecurityConfigChange, deactivateEmergencyControl);
router.post('/:key/extend', requireEmergencySecondFactor, validate(extendEmergencyFlagSchema), sensitiveActions.adminSecurityConfigChange, extendEmergencyControl);
router.patch('/:key/message', requireEmergencySecondFactor, validate(updateEmergencyMessageSchema), sensitiveActions.adminSecurityConfigChange, updateEmergencyControlMessage);

module.exports = router;
