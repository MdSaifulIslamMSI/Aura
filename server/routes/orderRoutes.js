const express = require('express');
const router = express.Router();
const {
    quoteOrder,
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
const { protect, admin, requireOtpAssurance, requireActiveAccount } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
    quoteOrderSchema,
    createOrderSchema,
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

router.post('/quote', protect, requireActiveAccount, requireOtpAssurance, validate(quoteOrderSchema), quoteOrder);

router.route('/').post(protect, requireActiveAccount, requireOtpAssurance, validate(createOrderSchema), addOrderItems).get(protect, admin, getOrders);
router.route('/myorders').get(protect, getMyOrders);
router.route('/:id/timeline').get(protect, validate(getOrderTimelineSchema), getMyOrderTimeline);
router.route('/:id/command-center')
    .get(protect, validate(commandCenterParamsSchema), getMyOrderCommandCenter);
router.route('/:id/command-center/refund')
    .post(protect, requireActiveAccount, validate(commandCenterRefundSchema), createOrderRefundRequest);
router.route('/:id/command-center/replace')
    .post(protect, requireActiveAccount, validate(commandCenterReplaceSchema), createOrderReplacementRequest);
router.route('/:id/command-center/support')
    .post(protect, requireActiveAccount, validate(commandCenterSupportSchema), createOrderSupportMessage);
router.route('/:id/command-center/warranty')
    .post(protect, requireActiveAccount, validate(commandCenterWarrantySchema), createOrderWarrantyClaim);
router.route('/:id/command-center/refund/:requestId/admin')
    .patch(protect, admin, validate(adminCommandRefundDecisionSchema), processOrderRefundRequestAdmin);
router.route('/:id/command-center/replace/:requestId/admin')
    .patch(protect, admin, validate(adminCommandReplacementDecisionSchema), processOrderReplacementRequestAdmin);
router.route('/:id/command-center/support/admin-reply')
    .post(protect, admin, validate(adminCommandSupportReplySchema), replyOrderSupportMessageAdmin);
router.route('/:id/command-center/warranty/:claimId/admin')
    .patch(protect, admin, validate(adminCommandWarrantyDecisionSchema), processOrderWarrantyClaimAdmin);
router.route('/:id/cancel')
    .post(protect, requireActiveAccount, validate(cancelOrderSchema), cancelOrder);
router.route('/:id/admin-cancel')
    .post(protect, admin, validate(adminCancelOrderSchema), cancelOrderAdmin);
router.route('/:id/status')
    .patch(protect, admin, validate(adminOrderStatusSchema), updateOrderStatusAdmin);

module.exports = router;
