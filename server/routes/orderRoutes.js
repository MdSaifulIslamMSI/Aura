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
const { rateLimit } = require('express-rate-limit');
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

const orderMutationRateLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: process.env.NODE_ENV === 'development' ? 1000 : 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    message: { message: 'Too many order changes. Please try again shortly.' },
});

const orderMutationLimiter = createDistributedRateLimit({
    allowInMemoryFallback: process.env.NODE_ENV !== 'production',
    name: 'order_mutation',
    securityCritical: true,
    windowMs: 5 * 60 * 1000,
    max: process.env.NODE_ENV === 'development' ? 300 : 60,
    keyGenerator: actorRateLimitKey,
    message: 'Too many order changes. Please try again shortly.',
});

const orderCommandCenterRateLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: process.env.NODE_ENV === 'development' ? 1000 : 400,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    message: { message: 'Too many order command center requests. Please try again shortly.' },
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

const orderAdminMutationRateLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: process.env.NODE_ENV === 'development' ? 1000 : 500,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    message: { message: 'Too many admin order changes. Please try again shortly.' },
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

router.route('/').post(protect, requireActiveAccount, requireOtpAssurance, orderMutationRateLimit, orderMutationLimiter, validate(createOrderSchema), sensitiveActions.orderStatusChange, addOrderItems).get(protect, admin, getOrders);
router.route('/myorders').get(protect, getMyOrders);
router.route('/:id/timeline').get(protect, orderCommandCenterRateLimit, orderCommandCenterLimiter, validate(getOrderTimelineSchema), authorizeOrderOwner('order.timeline.read'), getMyOrderTimeline);
router.route('/:id/command-center')
    .get(protect, orderCommandCenterRateLimit, orderCommandCenterLimiter, validate(commandCenterParamsSchema), authorizeOrderOwner('order.command_center.read'), getMyOrderCommandCenter);
router.route('/:id/command-center/refund')
    .post(protect, requireActiveAccount, orderCommandCenterRateLimit, orderCommandCenterLimiter, validate(commandCenterRefundSchema), authorizeOrderOwner('order.refund.request'), sensitiveActions.paymentRefund, createOrderRefundRequest);
router.route('/:id/command-center/replace')
    .post(protect, requireActiveAccount, orderCommandCenterRateLimit, orderCommandCenterLimiter, validate(commandCenterReplaceSchema), authorizeOrderOwner('order.replacement.request'), sensitiveActions.orderStatusChange, createOrderReplacementRequest);
router.route('/:id/command-center/support')
    .post(protect, requireActiveAccount, orderCommandCenterRateLimit, orderCommandCenterLimiter, validate(commandCenterSupportSchema), authorizeOrderOwner('order.support.write'), sensitiveActions.orderStatusChange, createOrderSupportMessage);
router.route('/:id/command-center/warranty')
    .post(protect, requireActiveAccount, orderCommandCenterRateLimit, orderCommandCenterLimiter, validate(commandCenterWarrantySchema), authorizeOrderOwner('order.warranty.request'), sensitiveActions.orderStatusChange, createOrderWarrantyClaim);
router.route('/:id/command-center/refund/:requestId/admin')
    .patch(protect, admin, orderAdminMutationRateLimit, orderAdminMutationLimiter, validate(adminCommandRefundDecisionSchema), sensitiveActions.paymentRefund, processOrderRefundRequestAdmin);
router.route('/:id/command-center/replace/:requestId/admin')
    .patch(protect, admin, orderAdminMutationRateLimit, orderAdminMutationLimiter, validate(adminCommandReplacementDecisionSchema), sensitiveActions.orderStatusChange, processOrderReplacementRequestAdmin);
router.route('/:id/command-center/support/admin-reply')
    .post(protect, admin, orderAdminMutationRateLimit, orderAdminMutationLimiter, validate(adminCommandSupportReplySchema), sensitiveActions.orderStatusChange, replyOrderSupportMessageAdmin);
router.route('/:id/command-center/warranty/:claimId/admin')
    .patch(protect, admin, orderAdminMutationRateLimit, orderAdminMutationLimiter, validate(adminCommandWarrantyDecisionSchema), sensitiveActions.orderStatusChange, processOrderWarrantyClaimAdmin);
router.route('/:id/cancel')
    .post(protect, requireActiveAccount, orderMutationRateLimit, orderMutationLimiter, validate(cancelOrderSchema), authorizeOrderOwner('order.cancel'), sensitiveActions.orderStatusChange, cancelOrder);
router.route('/:id/admin-cancel')
    .post(protect, admin, orderAdminMutationRateLimit, orderAdminMutationLimiter, validate(adminCancelOrderSchema), sensitiveActions.orderStatusChange, cancelOrderAdmin);
router.route('/:id/status')
    .patch(protect, admin, orderAdminMutationRateLimit, orderAdminMutationLimiter, validate(adminOrderStatusSchema), sensitiveActions.orderStatusChange, updateOrderStatusAdmin);

module.exports = router;
