const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const {
    getAdminPayments,
    getAdminPaymentById,
    getAdminRefundLedger,
    updateAdminRefundLedgerReference,
    captureAdminPayment,
    retryAdminCapture,
    getAdminPaymentOpsOverview,
    expireAdminStalePaymentIntents,
} = require('../controllers/paymentController');
const {
    adminPaymentListSchema,
    adminPaymentDetailSchema,
    adminPaymentOpsOverviewSchema,
    adminExpireStaleIntentsSchema,
    adminRefundLedgerListSchema,
    adminRefundLedgerUpdateSchema,
} = require('../validators/paymentValidators');

// CRITICAL: All payment admin routes require authentication
router.get('/', protect, admin, validate(adminPaymentListSchema), getAdminPayments);
router.get('/ops/overview', protect, admin, validate(adminPaymentOpsOverviewSchema), getAdminPaymentOpsOverview);
router.post('/ops/expire-stale', protect, admin, validate(adminExpireStaleIntentsSchema), sensitiveActions.paymentPayoutChange, expireAdminStalePaymentIntents);
router.get('/refunds/ledger', protect, admin, validate(adminRefundLedgerListSchema), getAdminRefundLedger);
router.patch(
    '/refunds/ledger/:orderId/:requestId/reference',
    protect,
    admin,
    validate(adminRefundLedgerUpdateSchema),
    sensitiveActions.paymentRefund,
    updateAdminRefundLedgerReference
);
router.get('/:intentId', protect, admin, validate(adminPaymentDetailSchema), getAdminPaymentById);
router.post('/:intentId/capture', protect, admin, validate(adminPaymentDetailSchema), sensitiveActions.paymentPayoutChange, captureAdminPayment);
router.post('/:intentId/retry-capture', protect, admin, validate(adminPaymentDetailSchema), sensitiveActions.paymentPayoutChange, retryAdminCapture);

module.exports = router;
