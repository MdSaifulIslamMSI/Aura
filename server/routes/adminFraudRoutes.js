const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const {
    listAdminFraudDecisions,
    resolveAdminFraudDecision,
} = require('../controllers/fraudDecisionController');
const {
    adminFraudDecisionListSchema,
    adminFraudDecisionResolveSchema,
} = require('../validators/fraudDecisionValidators');

router.get('/', protect, admin, validate(adminFraudDecisionListSchema), listAdminFraudDecisions);
router.patch('/:decisionId/resolve', protect, admin, validate(adminFraudDecisionResolveSchema), sensitiveActions.adminFraudModeration, resolveAdminFraudDecision);

module.exports = router;
