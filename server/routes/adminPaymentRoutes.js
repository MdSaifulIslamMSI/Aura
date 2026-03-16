const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
    getAdminPayments,
    getAdminPaymentById,
    getAdminRefundLedger,
    updateAdminRefundLedgerReference,
    captureAdminPayment,
    retryAdminCapture,
} = require('../controllers/paymentController');
const {
    adminPaymentListSchema,
    adminPaymentDetailSchema,
    adminRefundLedgerListSchema,
    adminRefundLedgerUpdateSchema,
} = require('../validators/paymentValidators');

// CRITICAL: All payment admin routes require authentication
router.get('/', protect, admin, validate(adminPaymentListSchema), getAdminPayments);
router.get('/refunds/ledger', protect, admin, validate(adminRefundLedgerListSchema), getAdminRefundLedger);
router.patch(
    '/refunds/ledger/:orderId/:requestId/reference',
    protect,
    admin,
    validate(adminRefundLedgerUpdateSchema),
    updateAdminRefundLedgerReference
);
router.get('/:intentId', protect, admin, validate(adminPaymentDetailSchema), getAdminPaymentById);
router.post('/:intentId/capture', protect, admin, validate(adminPaymentDetailSchema), captureAdminPayment);
router.post('/:intentId/retry-capture', protect, admin, validate(adminPaymentDetailSchema), retryAdminCapture);

module.exports = router;
