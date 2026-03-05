const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
    getAdminOpsReadiness,
    runAdminOpsSmoke,
} = require('../controllers/adminOpsController');
const {
    adminOpsReadinessSchema,
    adminOpsSmokeSchema,
} = require('../validators/adminOpsValidators');

const router = express.Router();

router.get('/readiness', protect, admin, validate(adminOpsReadinessSchema), getAdminOpsReadiness);
router.post('/smoke', protect, admin, validate(adminOpsSmokeSchema), runAdminOpsSmoke);

module.exports = router;

