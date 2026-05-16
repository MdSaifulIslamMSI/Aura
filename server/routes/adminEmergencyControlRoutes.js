const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
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
router.post('/:key/activate', requireEmergencySecondFactor, validate(activateEmergencyFlagSchema), activateEmergencyControl);
router.post('/:key/deactivate', requireEmergencySecondFactor, validate(deactivateEmergencyFlagSchema), deactivateEmergencyControl);
router.post('/:key/extend', requireEmergencySecondFactor, validate(extendEmergencyFlagSchema), extendEmergencyControl);
router.patch('/:key/message', requireEmergencySecondFactor, validate(updateEmergencyMessageSchema), updateEmergencyControlMessage);

module.exports = router;
