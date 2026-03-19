const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
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

router.get('/summary', protect, admin, validate(adminEmailOpsSummarySchema), getAdminEmailOpsSummary);
router.get('/deliveries', protect, admin, validate(adminEmailOpsDeliveryListSchema), listAdminEmailDeliveries);
router.get('/order-queue', protect, admin, validate(adminEmailOpsQueueListSchema), listAdminEmailQueue);
router.get('/order-queue/:notificationId', protect, admin, validate(adminEmailOpsQueueDetailSchema), getAdminEmailQueueItem);
router.post('/order-queue/:notificationId/retry', protect, admin, validate(adminEmailOpsQueueRetrySchema), retryAdminEmailQueueItem);
router.post('/test-send', protect, admin, validate(adminEmailOpsTestSendSchema), sendAdminEmailOpsTest);

module.exports = router;
