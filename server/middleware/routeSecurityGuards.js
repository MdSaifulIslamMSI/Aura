const mongoose = require('mongoose');
const Order = require('../models/Order');
const PaymentMethod = require('../models/PaymentMethod');
const Listing = require('../models/Listing');
const { requireSensitiveAction } = require('./sensitiveActionMiddleware');
const { authShieldMiddleware } = require('./authShieldMiddleware');
const { authorizeResource } = require('./authorizeResource');
const {
    SENSITIVE_ACTION_CATEGORIES,
    RISK_LEVELS,
} = require('../config/sensitiveActionPolicy');
const {
    resourceResolvers,
} = require('../security/authShield/resourceResolver');
const { getToolDefinition } = require('../services/ai/assistantToolRegistry');

const objectIdOrNull = (value = '') => (
    mongoose.isValidObjectId(String(value || '').trim()) ? String(value).trim() : null
);

const resolveAuthShieldResourceResolver = ({ action = '', resourceType = '' } = {}) => {
    const normalizedAction = String(action || '').trim().toLowerCase();
    const normalizedResource = String(resourceType || '').trim().toLowerCase();

    if (normalizedAction.includes('refund')) return resourceResolvers.paymentRefund;
    if (normalizedAction.startsWith('payment.method')) return resourceResolvers.paymentMethod;
    if (normalizedResource === 'payment') return resourceResolvers.payment;
    if (normalizedResource === 'order') return resourceResolvers.order;
    if (normalizedResource === 'listing' || normalizedResource === 'listing_escrow') return resourceResolvers.listing;
    if (normalizedResource === 'user') return resourceResolvers.user;
    if (normalizedResource === 'upload') return resourceResolvers.uploadModeration;
    if (normalizedResource === 'moderation' || normalizedResource === 'fraud_decision') return resourceResolvers.review;
    if (normalizedResource === 'auth' || normalizedResource === 'auth_factor') return resourceResolvers.user;
    if (normalizedAction.startsWith('admin.')) return resourceResolvers.adminConfig;
    return null;
};

const composeMiddleware = (...middlewares) => (req, res, next) => {
    let index = 0;
    const run = (error) => {
        if (error) return next(error);
        const middleware = middlewares[index];
        index += 1;
        if (!middleware) return next();
        return middleware(req, res, run);
    };
    return run();
};

const routeSensitiveAction = ({
    action,
    category,
    riskLevel = RISK_LEVELS.HIGH,
    resourceType = '',
    control = 'route_sensitive_action',
} = {}) => {
    const authShield = authShieldMiddleware({
        action,
        sensitivity: riskLevel === RISK_LEVELS.CRITICAL
            ? 'critical'
            : riskLevel === RISK_LEVELS.HIGH
                ? 'high'
                : 'medium',
        resourceResolver: resolveAuthShieldResourceResolver({ action, resourceType }),
        allowAuthenticatedWithoutResource: ['ai', 'ai_session', 'email_operation', 'analytics', 'payment'].includes(resourceType),
        requireFreshAuth: riskLevel === RISK_LEVELS.CRITICAL || riskLevel === RISK_LEVELS.HIGH,
        requireDeviceProof: action === 'payment.refund.create' || action === 'payment.payout.change',
        requireReplayNonce: riskLevel === RISK_LEVELS.CRITICAL,
    });
    const sensitiveAction = requireSensitiveAction({
        action,
        category,
        riskLevel,
        resourceType,
        auditMeta: { control },
    });
    return composeMiddleware(authShield, sensitiveAction);
};

const sensitiveActions = Object.freeze({
    adminUserMutation: routeSensitiveAction({
        action: 'admin.users.mutate',
        category: SENSITIVE_ACTION_CATEGORIES.ADMIN_USER_MANAGEMENT,
        riskLevel: RISK_LEVELS.CRITICAL,
        resourceType: 'user',
    }),
    adminProductChange: routeSensitiveAction({
        action: 'admin.products.mutate',
        category: SENSITIVE_ACTION_CATEGORIES.ADMIN_STATE_CHANGE,
        riskLevel: RISK_LEVELS.HIGH,
        resourceType: 'product',
    }),
    adminCatalogChange: routeSensitiveAction({
        action: 'admin.catalog.mutate',
        category: SENSITIVE_ACTION_CATEGORIES.ADMIN_STATE_CHANGE,
        riskLevel: RISK_LEVELS.HIGH,
        resourceType: 'catalog',
    }),
    adminFraudModeration: routeSensitiveAction({
        action: 'admin.fraud.resolve',
        category: SENSITIVE_ACTION_CATEGORIES.MODERATION_ACTION,
        riskLevel: RISK_LEVELS.HIGH,
        resourceType: 'fraud_decision',
    }),
    adminEmailOperation: routeSensitiveAction({
        action: 'admin.email.operation',
        category: SENSITIVE_ACTION_CATEGORIES.ADMIN_STATE_CHANGE,
        riskLevel: RISK_LEVELS.HIGH,
        resourceType: 'email_operation',
    }),
    adminNotificationChange: routeSensitiveAction({
        action: 'admin.notifications.mutate',
        category: SENSITIVE_ACTION_CATEGORIES.ADMIN_STATE_CHANGE,
        riskLevel: RISK_LEVELS.MEDIUM,
        resourceType: 'admin_notification',
    }),
    adminSecurityConfigChange: routeSensitiveAction({
        action: 'admin.security_config.change',
        category: SENSITIVE_ACTION_CATEGORIES.ADMIN_SECURITY_CONFIG_CHANGE,
        riskLevel: RISK_LEVELS.CRITICAL,
        resourceType: 'admin_control',
    }),
    dataExport: routeSensitiveAction({
        action: 'admin.analytics.export',
        category: SENSITIVE_ACTION_CATEGORIES.DATA_EXPORT,
        riskLevel: RISK_LEVELS.HIGH,
        resourceType: 'analytics',
    }),
    paymentRefund: routeSensitiveAction({
        action: 'payment.refund.create',
        category: SENSITIVE_ACTION_CATEGORIES.PAYMENT_REFUND,
        riskLevel: RISK_LEVELS.CRITICAL,
        resourceType: 'payment',
    }),
    paymentPayoutChange: routeSensitiveAction({
        action: 'payment.payout.change',
        category: SENSITIVE_ACTION_CATEGORIES.PAYMENT_PAYOUT_CHANGE,
        riskLevel: RISK_LEVELS.CRITICAL,
        resourceType: 'payment',
    }),
    orderStatusChange: routeSensitiveAction({
        action: 'order.status.change',
        category: SENSITIVE_ACTION_CATEGORIES.ORDER_STATUS_CHANGE,
        riskLevel: RISK_LEVELS.HIGH,
        resourceType: 'order',
    }),
    uploadWrite: routeSensitiveAction({
        action: 'upload.write',
        category: SENSITIVE_ACTION_CATEGORIES.UPLOAD_WRITE,
        riskLevel: RISK_LEVELS.MEDIUM,
        resourceType: 'upload',
    }),
    moderationAction: routeSensitiveAction({
        action: 'moderation.action',
        category: SENSITIVE_ACTION_CATEGORIES.MODERATION_ACTION,
        riskLevel: RISK_LEVELS.HIGH,
        resourceType: 'moderation',
    }),
    accountRecoveryChange: routeSensitiveAction({
        action: 'auth.recovery.change',
        category: SENSITIVE_ACTION_CATEGORIES.ACCOUNT_RECOVERY_CHANGE,
        riskLevel: RISK_LEVELS.CRITICAL,
        resourceType: 'auth',
    }),
    authFactorChange: routeSensitiveAction({
        action: 'auth.factor.change',
        category: SENSITIVE_ACTION_CATEGORIES.PASSWORD_OR_AUTH_FACTOR_CHANGE,
        riskLevel: RISK_LEVELS.CRITICAL,
        resourceType: 'auth_factor',
    }),
    aiSessionMutation: routeSensitiveAction({
        action: 'ai.session.mutate',
        category: SENSITIVE_ACTION_CATEGORIES.AI_TOOL_ACTION,
        riskLevel: RISK_LEVELS.MEDIUM,
        resourceType: 'ai_session',
    }),
    aiToolAction: routeSensitiveAction({
        action: 'ai.tool.action',
        category: SENSITIVE_ACTION_CATEGORIES.AI_TOOL_ACTION,
        riskLevel: RISK_LEVELS.HIGH,
        resourceType: 'ai',
    }),
    listingWrite: routeSensitiveAction({
        action: 'listing.write',
        category: SENSITIVE_ACTION_CATEGORIES.UPLOAD_WRITE,
        riskLevel: RISK_LEVELS.MEDIUM,
        resourceType: 'listing',
    }),
    listingEscrowChange: routeSensitiveAction({
        action: 'listing.escrow.change',
        category: SENSITIVE_ACTION_CATEGORIES.PAYMENT_PAYOUT_CHANGE,
        riskLevel: RISK_LEVELS.HIGH,
        resourceType: 'listing_escrow',
    }),
    supportModeration: routeSensitiveAction({
        action: 'support.moderation.change',
        category: SENSITIVE_ACTION_CATEGORIES.MODERATION_ACTION,
        riskLevel: RISK_LEVELS.MEDIUM,
        resourceType: 'support_ticket',
    }),
});

const resolveOrderResource = async (req = {}) => {
    const orderId = objectIdOrNull(req.params?.id);
    if (!orderId) return null;
    const order = await Order.findById(orderId).select('_id user').lean();
    if (!order) return null;
    return {
        _id: order._id,
        id: order._id,
        type: 'order',
        ownerId: order.user,
        userId: order.user,
    };
};

const resolvePaymentMethodResource = async (req = {}) => {
    const methodId = objectIdOrNull(req.params?.methodId);
    if (!methodId) return null;
    const method = await PaymentMethod.findById(methodId).select('_id user').lean();
    if (!method) return null;
    return {
        _id: method._id,
        id: method._id,
        type: 'payment_method',
        ownerId: method.user,
        userId: method.user,
    };
};

const resolveListingResource = async (req = {}) => {
    const listingId = objectIdOrNull(req.params?.id);
    if (!listingId) return null;
    const listing = await Listing.findById(listingId).select('_id seller').lean();
    if (!listing) return null;
    return {
        _id: listing._id,
        id: listing._id,
        type: 'listing',
        ownerId: listing.seller,
        userId: listing.seller,
    };
};

const authorizeOrderOwner = (action = 'order.write') => authorizeResource({
    action,
    allowOwner: true,
    allowAdmin: false,
    hideResourceExistence: true,
    resolveResource: resolveOrderResource,
});

const authorizePaymentMethodOwner = (action = 'payment_method.write') => authorizeResource({
    action,
    allowOwner: true,
    allowAdmin: false,
    hideResourceExistence: true,
    resolveResource: resolvePaymentMethodResource,
});

const authorizeListingOwner = (action = 'listing.write') => authorizeResource({
    action,
    allowOwner: true,
    allowAdmin: false,
    hideResourceExistence: true,
    resolveResource: resolveListingResource,
});

const normalizeActionType = (value = '') => String(value || '').trim().toLowerCase();
const SENSITIVE_AI_ACTION_PATTERN = /\b(admin|refund|payment|payout|delete|recover|recovery|password|factor|webauthn|upload|moderation|cancel_order|create_return_request|add_to_cart|remove_from_cart)\b/i;

const hasSensitiveAiToolAction = (req = {}) => {
    const actionType = normalizeActionType(req.body?.actionRequest?.type);
    if (!actionType) return false;
    const definition = getToolDefinition(actionType);
    return Boolean(definition?.mutation) || SENSITIVE_AI_ACTION_PATTERN.test(actionType);
};

const requireAiToolActionPolicy = (req, res, next) => {
    if (!hasSensitiveAiToolAction(req)) {
        return next();
    }
    return sensitiveActions.aiToolAction(req, res, next);
};

module.exports = {
    authorizeListingOwner,
    authorizeOrderOwner,
    authorizePaymentMethodOwner,
    requireAiToolActionPolicy,
    routeSensitiveAction,
    sensitiveActions,
};
