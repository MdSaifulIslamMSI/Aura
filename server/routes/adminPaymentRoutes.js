const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { requireSecurityDecision } = require('../middleware/requireSecurityDecision');
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

const auditPaymentRefundApprove = requireSecurityDecision('payment.refund.approve', {
    resourceType: 'payment',
    resourceIdParam: 'orderId',
});
const auditPaymentPayoutUpdate = requireSecurityDecision('payment.payout.update', {
    resourceType: 'payment',
    resourceIdParam: 'intentId',
});

// CRITICAL: All payment admin routes require authentication
router.get('/', protect, admin, validate(adminPaymentListSchema), getAdminPayments);
router.get('/ops/overview', protect, admin, validate(adminPaymentOpsOverviewSchema), getAdminPaymentOpsOverview);
router.post('/ops/expire-stale', protect, admin, validate(adminExpireStaleIntentsSchema), auditPaymentPayoutUpdate, sensitiveActions.paymentPayoutChange, expireAdminStalePaymentIntents);
router.get('/refunds/ledger', protect, admin, validate(adminRefundLedgerListSchema), getAdminRefundLedger);
router.patch(
    '/refunds/ledger/:orderId/:requestId/reference',
    protect,
    admin,
    validate(adminRefundLedgerUpdateSchema),
    auditPaymentRefundApprove,
    sensitiveActions.paymentRefund,
    updateAdminRefundLedgerReference
);
router.get('/:intentId', protect, admin, validate(adminPaymentDetailSchema), getAdminPaymentById);
router.post('/:intentId/capture', protect, admin, validate(adminPaymentDetailSchema), auditPaymentPayoutUpdate, sensitiveActions.paymentPayoutChange, captureAdminPayment);
router.post('/:intentId/retry-capture', protect, admin, validate(adminPaymentDetailSchema), auditPaymentPayoutUpdate, sensitiveActions.paymentPayoutChange, retryAdminCapture);

module.exports = router;
