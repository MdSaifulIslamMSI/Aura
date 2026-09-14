const logger = require('../utils/logger');
const User = require('../models/User');
const AccountPreference = require('../models/AccountPreference');
const { sendPersistentNotification } = require('./notificationService');
const { sendMessageToUser } = require('./socketService');
const {
    enqueueOrderPlacedEmail,
    enqueueOrderEventEmail,
    ORDER_EVENT_TYPES,
} = require('./email/orderEmailQueueService');

// Maps each lifecycle event to the AccountPreference category that governs
// it. The placed confirmation is transactional (a receipt) and is therefore
// sent regardless of marketing-style opt-outs; every later event IS gated.
const EVENT_CATEGORY = {
    order_placed: 'orderUpdates',
    order_confirmed: 'orderUpdates',
    order_cancelled: 'orderUpdates',
    order_shipped: 'deliveryUpdates',
    order_out_for_delivery: 'deliveryUpdates',
    order_delivered: 'deliveryUpdates',
    order_refunded: 'returnRefundUpdates',
    replacement_approved: 'returnRefundUpdates',
    replacement_dispatched: 'returnRefundUpdates',
};

// Opt-out semantics: an explicit `false` disables a channel; anything else
// (missing doc, missing category, missing channel) stays enabled so the
// AccountPreference document can never silently suppress order updates.
const CHANNEL_DEFAULTS = { email: true, sms: false, push: true };

const parseBooleanEnv = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

// Preference gating defaults ON; set ORDER_NOTIFICATION_PREFERENCES_ENABLED=false
// to bypass the AccountPreference lookup entirely.
const orderNotificationPrefsEnabled = () => parseBooleanEnv(process.env.ORDER_NOTIFICATION_PREFERENCES_ENABLED ?? 'true');

const resolveChannelPreferences = async ({ userId, eventType }) => {
    const categoryKey = EVENT_CATEGORY[eventType];
    if (!categoryKey) return { ...CHANNEL_DEFAULTS };
    try {
        const user = await User.findById(userId).select('authUid').lean();
        const ownerKeys = [String(userId || ''), String(user?.authUid || '')].filter(Boolean);
        if (ownerKeys.length === 0) return { ...CHANNEL_DEFAULTS };

        const preference = await AccountPreference
            .findOne({ ownerKey: { $in: ownerKeys } })
            .select('notifications')
            .lean();
        const channels = preference?.notifications?.[categoryKey] || {};
        return {
            email: channels.email !== false,
            sms: channels.sms === true,
            push: channels.push !== false,
        };
    } catch (error) {
        logger.warn('order_notification.preference_lookup_failed', {
            userId: String(userId || ''),
            eventType,
            error: error.message,
        });
        return { ...CHANNEL_DEFAULTS };
    }
};

/**
 * Single fan-out point for order lifecycle events: email (via the durable
 * order email queue), in-app notification (UserNotification + socket) and a
 * live `order.updated` socket broadcast for the storefront.
 */
const emitOrderEventNotification = async ({
    order,
    user = null,
    eventType,
    title = '',
    message = '',
    details = [],
    trackingId = '',
    requestId = '',
}) => {
    const userId = order?.user?._id || order?.user;
    if (!userId || !eventType) {
        return { skipped: true, reason: 'missing_target_or_event' };
    }

    const prefsEnabled = orderNotificationPrefsEnabled();
    const prefs = prefsEnabled
        ? await resolveChannelPreferences({ userId, eventType })
        : { ...CHANNEL_DEFAULTS };
    const results = { email: null, inApp: null, socket: false };

    if (prefs.email && (eventType === 'order_placed' || ORDER_EVENT_TYPES.has(eventType))) {
        try {
            const targetUser = user || await User.findById(userId).select('name email').lean();
            const enqueue = eventType === 'order_placed'
                ? enqueueOrderPlacedEmail
                : enqueueOrderEventEmail;
            results.email = await enqueue({
                order,
                user: targetUser,
                eventType,
                message,
                details,
                trackingId,
                requestId,
            });
        } catch (error) {
            logger.warn('order_notification.email_enqueue_failed', {
                orderId: String(order?._id || ''),
                eventType,
                error: error.message,
            });
        }
    }

    if (prefs.push && title) {
        try {
            results.inApp = await sendPersistentNotification(
                userId,
                title,
                message || 'Your order has an update.',
                'order',
                {
                    relatedEntity: String(order?._id || ''),
                    actionUrl: '/orders',
                }
            );
        } catch (error) {
            logger.warn('order_notification.inapp_send_failed', {
                orderId: String(order?._id || ''),
                eventType,
                error: error.message,
            });
        }
    }

    try {
        sendMessageToUser(userId, 'order.updated', {
            orderId: String(order?._id || ''),
            eventType,
            orderStatus: order?.orderStatus || '',
            shipments: Array.isArray(order?.shipments) ? order.shipments.slice(-3) : [],
            statusTimeline: Array.isArray(order?.statusTimeline) ? order.statusTimeline.slice(-10) : [],
            at: new Date().toISOString(),
        });
        results.socket = true;
    } catch (error) {
        logger.warn('order_notification.socket_emit_failed', {
            orderId: String(order?._id || ''),
            eventType,
            error: error.message,
        });
    }

    return { skipped: false, ...results };
};

module.exports = {
    EVENT_CATEGORY,
    emitOrderEventNotification,
    resolveChannelPreferences,
};
