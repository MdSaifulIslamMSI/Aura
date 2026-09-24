const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { sensitiveActions } = require('../middleware/routeSecurityGuards');
const { requireTrustDecision } = require('../trust/middleware/requireTrustDecision');
const { loadPaymentIntentResource } = require('../trust/adapters/paymentAdapter');
const { loadOrderResource } = require('../trust/adapters/orderAdapter');
const {
    getAdminPayments,
    getAdminPaymentById,
    getAdminRefundLedger,
    updateAdminRefundLedgerReference,
    captureAdminPayment,
    retryAdminCapture,
    createAdminRefund,
    getAdminPaymentOpsOverview,
    expireAdminStalePaymentIntents,
} = require('../controllers/paymentController');
const {
    adminPaymentListSchema,
    adminPaymentDetailSchema,
    adminPaymentActionSchema,
    adminPaymentOpsOverviewSchema,
    adminExpireStaleIntentsSchema,
    adminRefundLedgerListSchema,
    adminRefundLedgerUpdateSchema,
    adminRefundCreateSchema,
} = require('../validators/paymentValidators');

// CRITICAL: All payment admin routes require authentication
router.get('/', protect, admin, validate(adminPaymentListSchema), getAdminPayments);
router.get('/ops/overview', protect, admin, validate(adminPaymentOpsOverviewSchema), getAdminPaymentOpsOverview);
router.post('/ops/expire-stale', protect, admin, validate(adminExpireStaleIntentsSchema), requireTrustDecision('admin.payment.expire'), sensitiveActions.paymentPayoutChange, expireAdminStalePaymentIntents);
router.get('/refunds/ledger', protect, admin, validate(adminRefundLedgerListSchema), getAdminRefundLedger);
router.patch(
    '/refunds/ledger/:orderId/:requestId/reference',
    protect,
    admin,
    validate(adminRefundLedgerUpdateSchema),
    requireTrustDecision('admin.payment.refund', loadOrderResource),
    sensitiveActions.paymentRefund,
    updateAdminRefundLedgerReference
);
router.get('/:intentId', protect, admin, validate(adminPaymentDetailSchema), getAdminPaymentById);
router.post('/:intentId/capture', protect, admin, validate(adminPaymentActionSchema), requireTrustDecision('admin.payment.capture', loadPaymentIntentResource), sensitiveActions.paymentPayoutChange, captureAdminPayment);
router.post('/:intentId/retry-capture', protect, admin, validate(adminPaymentActionSchema), requireTrustDecision('admin.payment.capture', loadPaymentIntentResource), sensitiveActions.paymentPayoutChange, retryAdminCapture);
router.post('/:intentId/refunds', protect, admin, validate(adminRefundCreateSchema), requireTrustDecision('admin.payment.refund', loadPaymentIntentResource), sensitiveActions.paymentRefund, createAdminRefund);

module.exports = router;
