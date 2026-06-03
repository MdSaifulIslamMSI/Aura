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
const { createDistributedRateLimit } = require('../middleware/distributedRateLimit');
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

const actorRateLimitKey = (req) => (
    req.authUid
    || req.user?._id?.toString()
    || req.user?.id
    || req.user?.email
    || req.ip
);

const orderMutationLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    name: 'order_mutation',
    securityCritical: true,
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 60,
    keyGenerator: actorRateLimitKey,
    message: 'Too many order changes. Please try again shortly.',
});

const orderCommandCenterLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    name: 'order_command_center',
    securityCritical: true,
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 80,
    keyGenerator: actorRateLimitKey,
    message: 'Too many order command center requests. Please try again shortly.',
});

const orderAdminMutationLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    name: 'order_admin_mutation',
    securityCritical: true,
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 100,
    keyGenerator: actorRateLimitKey,
    message: 'Too many admin order changes. Please try again shortly.',
});

router.post('/quote', protect, requireActiveAccount, requireOtpAssurance, validate(quoteOrderSchema), quoteOrder);

router.route('/').post(protect, requireActiveAccount, requireOtpAssurance, orderMutationLimiter, validate(createOrderSchema), sensitiveActions.orderStatusChange, addOrderItems).get(protect, admin, getOrders);
router.route('/myorders').get(protect, getMyOrders);
// Distributed limiter immediately precedes owner authorization.
// codeql[js/missing-rate-limiting]
router.route('/:id/timeline').get(protect, orderCommandCenterLimiter, validate(getOrderTimelineSchema), authorizeOrderOwner('order.timeline.read'), getMyOrderTimeline);
router.route('/:id/command-center')
    // Distributed limiter immediately precedes owner authorization.
    // codeql[js/missing-rate-limiting]
    .get(protect, orderCommandCenterLimiter, validate(commandCenterParamsSchema), authorizeOrderOwner('order.command_center.read'), getMyOrderCommandCenter);
router.route('/:id/command-center/refund')
    // Distributed limiter immediately precedes owner authorization.
    // codeql[js/missing-rate-limiting]
    .post(protect, requireActiveAccount, orderCommandCenterLimiter, validate(commandCenterRefundSchema), authorizeOrderOwner('order.refund.request'), sensitiveActions.paymentRefund, createOrderRefundRequest);
router.route('/:id/command-center/replace')
    // Distributed limiter immediately precedes owner authorization.
    // codeql[js/missing-rate-limiting]
    .post(protect, requireActiveAccount, orderCommandCenterLimiter, validate(commandCenterReplaceSchema), authorizeOrderOwner('order.replacement.request'), sensitiveActions.orderStatusChange, createOrderReplacementRequest);
router.route('/:id/command-center/support')
    // Distributed limiter immediately precedes owner authorization.
    // codeql[js/missing-rate-limiting]
    .post(protect, requireActiveAccount, orderCommandCenterLimiter, validate(commandCenterSupportSchema), authorizeOrderOwner('order.support.write'), sensitiveActions.orderStatusChange, createOrderSupportMessage);
router.route('/:id/command-center/warranty')
    // Distributed limiter immediately precedes owner authorization.
    // codeql[js/missing-rate-limiting]
    .post(protect, requireActiveAccount, orderCommandCenterLimiter, validate(commandCenterWarrantySchema), authorizeOrderOwner('order.warranty.request'), sensitiveActions.orderStatusChange, createOrderWarrantyClaim);
router.route('/:id/command-center/refund/:requestId/admin')
    .patch(protect, admin, orderAdminMutationLimiter, validate(adminCommandRefundDecisionSchema), sensitiveActions.paymentRefund, processOrderRefundRequestAdmin);
router.route('/:id/command-center/replace/:requestId/admin')
    .patch(protect, admin, orderAdminMutationLimiter, validate(adminCommandReplacementDecisionSchema), sensitiveActions.orderStatusChange, processOrderReplacementRequestAdmin);
router.route('/:id/command-center/support/admin-reply')
    .post(protect, admin, orderAdminMutationLimiter, validate(adminCommandSupportReplySchema), sensitiveActions.orderStatusChange, replyOrderSupportMessageAdmin);
router.route('/:id/command-center/warranty/:claimId/admin')
    .patch(protect, admin, orderAdminMutationLimiter, validate(adminCommandWarrantyDecisionSchema), sensitiveActions.orderStatusChange, processOrderWarrantyClaimAdmin);
router.route('/:id/cancel')
    // Distributed limiter immediately precedes owner authorization.
    // codeql[js/missing-rate-limiting]
    .post(protect, requireActiveAccount, orderMutationLimiter, validate(cancelOrderSchema), authorizeOrderOwner('order.cancel'), sensitiveActions.orderStatusChange, cancelOrder);
router.route('/:id/admin-cancel')
    .post(protect, admin, orderAdminMutationLimiter, validate(adminCancelOrderSchema), sensitiveActions.orderStatusChange, cancelOrderAdmin);
router.route('/:id/status')
    .patch(protect, admin, orderAdminMutationLimiter, validate(adminOrderStatusSchema), sensitiveActions.orderStatusChange, updateOrderStatusAdmin);

module.exports = router;
