const express = require('express');
const router = express.Router();
const {
    quoteOrder,
    simulatePayment,
    addOrderItems,
    getMyOrderTimeline,
    getMyOrderCommandCenter,
    createOrderRefundRequest,
    createOrderReplacementRequest,
    createOrderSupportMessage,
    createOrderWarrantyClaim,
    processOrderRefundRequestAdmin,
    processOrderReplacementRequestAdmin,
    replyOrderSupportMessageAdmin,
    processOrderWarrantyClaimAdmin,
    cancelOrder,
    cancelOrderAdmin,
    updateOrderStatusAdmin,
    getMyOrders,
    getOrders
} = require('../controllers/orderController');
const { protect, admin, requireOtpAssurance } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
    quoteOrderSchema,
    createOrderSchema,
    simulatePaymentSchema,
    getOrderTimelineSchema,
    commandCenterParamsSchema,
    commandCenterRefundSchema,
    commandCenterReplaceSchema,
    commandCenterSupportSchema,
    commandCenterWarrantySchema,
    cancelOrderSchema,
    adminOrderStatusSchema,
    adminCancelOrderSchema,
    adminCommandRefundDecisionSchema,
    adminCommandReplacementDecisionSchema,
    adminCommandSupportReplySchema,
    adminCommandWarrantyDecisionSchema,
} = require('../validators/orderValidators');

router.post('/quote', protect, requireOtpAssurance, validate(quoteOrderSchema), quoteOrder);
router.post('/simulate-payment', protect, requireOtpAssurance, validate(simulatePaymentSchema), simulatePayment);

router.route('/').post(protect, requireOtpAssurance, validate(createOrderSchema), addOrderItems).get(protect, admin, getOrders);
router.route('/myorders').get(protect, getMyOrders);
router.route('/:id/timeline').get(protect, validate(getOrderTimelineSchema), getMyOrderTimeline);
router.route('/:id/command-center')
    .get(protect, validate(commandCenterParamsSchema), getMyOrderCommandCenter);
router.route('/:id/command-center/refund')
    .post(protect, validate(commandCenterRefundSchema), createOrderRefundRequest);
router.route('/:id/command-center/replace')
    .post(protect, validate(commandCenterReplaceSchema), createOrderReplacementRequest);
router.route('/:id/command-center/support')
    .post(protect, validate(commandCenterSupportSchema), createOrderSupportMessage);
router.route('/:id/command-center/warranty')
    .post(protect, validate(commandCenterWarrantySchema), createOrderWarrantyClaim);
router.route('/:id/command-center/refund/:requestId/admin')
    .patch(protect, admin, validate(adminCommandRefundDecisionSchema), processOrderRefundRequestAdmin);
router.route('/:id/command-center/replace/:requestId/admin')
    .patch(protect, admin, validate(adminCommandReplacementDecisionSchema), processOrderReplacementRequestAdmin);
router.route('/:id/command-center/support/admin-reply')
    .post(protect, admin, validate(adminCommandSupportReplySchema), replyOrderSupportMessageAdmin);
router.route('/:id/command-center/warranty/:claimId/admin')
    .patch(protect, admin, validate(adminCommandWarrantyDecisionSchema), processOrderWarrantyClaimAdmin);
router.route('/:id/cancel')
    .post(protect, validate(cancelOrderSchema), cancelOrder);
router.route('/:id/admin-cancel')
    .post(protect, admin, validate(adminCancelOrderSchema), cancelOrderAdmin);
router.route('/:id/status')
    .patch(protect, admin, validate(adminOrderStatusSchema), updateOrderStatusAdmin);

module.exports = router;
