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
    authorizeOrderOwner,
    sensitiveActions,
} = require('../middleware/routeSecurityGuards');
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

router.route('/').post(protect, requireActiveAccount, requireOtpAssurance, validate(createOrderSchema), sensitiveActions.orderStatusChange, addOrderItems).get(protect, admin, getOrders);
router.route('/myorders').get(protect, getMyOrders);
router.route('/:id/timeline').get(protect, validate(getOrderTimelineSchema), authorizeOrderOwner('order.timeline.read'), getMyOrderTimeline);
router.route('/:id/command-center')
    .get(protect, validate(commandCenterParamsSchema), authorizeOrderOwner('order.command_center.read'), getMyOrderCommandCenter);
router.route('/:id/command-center/refund')
    .post(protect, requireActiveAccount, validate(commandCenterRefundSchema), authorizeOrderOwner('order.refund.request'), sensitiveActions.paymentRefund, createOrderRefundRequest);
router.route('/:id/command-center/replace')
    .post(protect, requireActiveAccount, validate(commandCenterReplaceSchema), authorizeOrderOwner('order.replacement.request'), sensitiveActions.orderStatusChange, createOrderReplacementRequest);
router.route('/:id/command-center/support')
    .post(protect, requireActiveAccount, validate(commandCenterSupportSchema), authorizeOrderOwner('order.support.write'), sensitiveActions.orderStatusChange, createOrderSupportMessage);
router.route('/:id/command-center/warranty')
    .post(protect, requireActiveAccount, validate(commandCenterWarrantySchema), authorizeOrderOwner('order.warranty.request'), sensitiveActions.orderStatusChange, createOrderWarrantyClaim);
router.route('/:id/command-center/refund/:requestId/admin')
    .patch(protect, admin, validate(adminCommandRefundDecisionSchema), sensitiveActions.paymentRefund, processOrderRefundRequestAdmin);
router.route('/:id/command-center/replace/:requestId/admin')
    .patch(protect, admin, validate(adminCommandReplacementDecisionSchema), sensitiveActions.orderStatusChange, processOrderReplacementRequestAdmin);
router.route('/:id/command-center/support/admin-reply')
    .post(protect, admin, validate(adminCommandSupportReplySchema), sensitiveActions.orderStatusChange, replyOrderSupportMessageAdmin);
router.route('/:id/command-center/warranty/:claimId/admin')
    .patch(protect, admin, validate(adminCommandWarrantyDecisionSchema), sensitiveActions.orderStatusChange, processOrderWarrantyClaimAdmin);
router.route('/:id/cancel')
    .post(protect, requireActiveAccount, validate(cancelOrderSchema), authorizeOrderOwner('order.cancel'), sensitiveActions.orderStatusChange, cancelOrder);
router.route('/:id/admin-cancel')
    .post(protect, admin, validate(adminCancelOrderSchema), sensitiveActions.orderStatusChange, cancelOrderAdmin);
router.route('/:id/status')
    .patch(protect, admin, validate(adminOrderStatusSchema), sensitiveActions.orderStatusChange, updateOrderStatusAdmin);

module.exports = router;
