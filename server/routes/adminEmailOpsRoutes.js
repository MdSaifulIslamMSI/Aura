const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
const { buildRateLimitKey } = require('../services/adminRecoveryGrantService');
const {
    getAdminEmailOpsSummary,
    listAdminEmailDeliveries,
    listAdminEmailQueue,
    getAdminEmailQueueItem,
    retryAdminEmailQueueItem,
    sendAdminEmailOpsTest,
} = require('../controllers/emailOpsAdminController');
const {
    adminEmailOpsSummarySchema,
    adminEmailOpsDeliveryListSchema,
    adminEmailOpsQueueListSchema,
    adminEmailOpsQueueDetailSchema,
    adminEmailOpsQueueRetrySchema,
    adminEmailOpsTestSendSchema,
} = require('../validators/emailOpsValidators');

const testSendLimiter = createDistributedRateLimit({
    name: 'admin_email_ops_test_send',
    windowMs: 10 * 60 * 1000,
    max: 10,
    securityCritical: true,
    keyGenerator: (req) => buildRateLimitKey('admin_email_ops_test_send', req),
    message: {
        success: false,
        code: 'ADMIN_EMAIL_TEST_RATE_LIMITED',
        message: 'Too many test emails. Wait before sending again.',
    },
});

router.get('/summary', protect, admin, validate(adminEmailOpsSummarySchema), getAdminEmailOpsSummary);
router.get('/deliveries', protect, admin, validate(adminEmailOpsDeliveryListSchema), listAdminEmailDeliveries);
router.get('/order-queue', protect, admin, validate(adminEmailOpsQueueListSchema), listAdminEmailQueue);
router.get('/order-queue/:notificationId', protect, admin, validate(adminEmailOpsQueueDetailSchema), getAdminEmailQueueItem);
router.post('/order-queue/:notificationId/retry', protect, admin, validate(adminEmailOpsQueueRetrySchema), sensitiveActions.adminEmailOperation, retryAdminEmailQueueItem);
router.post('/test-send', protect, admin, testSendLimiter, validate(adminEmailOpsTestSendSchema), sensitiveActions.adminEmailOperation, sendAdminEmailOpsTest);

module.exports = router;
