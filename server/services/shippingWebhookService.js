const crypto = require('crypto');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const Order = require('../models/Order');
const ShippingEvent = require('../models/ShippingEvent');
const { recordShipmentCheckpoint, canTransitionShipmentStatus } = require('./orderService');
const { recordOrderEvent } = require('../middleware/metrics');

// Inbound courier checkpoint webhooks. Trust model mirrors the payment
// webhooks: per-provider HMAC over the exact raw request bytes, eventId
// dedupe on the ShippingEvent ledger, and checkpoint application through the
// same guarded transition path the admin endpoint uses.
const webhookSecretFor = (provider) => process.env[`SHIPPING_WEBHOOK_SECRET_${String(provider).toUpperCase()}`] || '';

const verifyWebhookSignature = ({ provider, rawBody, signature }) => {
    const secret = webhookSecretFor(provider);
    if (!secret) {
        // Fail closed: an unconfigured provider rejects everything (503-style
        // contract handled by the route returning 503).
        return { valid: false, unconfigured: true };
    }
    if (!rawBody || !signature) return { valid: false };

    const provided = String(signature).replace(/^sha256=/i, '').trim();
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return { valid: false };
    return { valid: crypto.timingSafeEqual(a, b) };
};

const hashPayload = (payload) => crypto
    .createHash('sha256')
    .update(JSON.stringify(payload ?? {}))
    .digest('hex');

const parseCheckpointEvent = (rawBody) => {
    let parsed;
    try {
        parsed = JSON.parse(String(rawBody || '{}'));
    } catch {
        throw new AppError('Malformed webhook payload', 400);
    }

    const eventId = String(parsed?.eventId || parsed?.id || '').trim();
    const trackingId = String(parsed?.trackingId || parsed?.awb || '').trim();
    const status = String(parsed?.status || '').trim().toLowerCase();
    if (!eventId) throw new AppError('Webhook eventId is required', 400);
    if (!trackingId) throw new AppError('Webhook trackingId is required', 400);
    if (!canTransitionShipmentStatus({ currentStatus: 'pending', targetStatus: status })
        && !['packed', 'shipped', 'out_for_delivery', 'delivered', 'returned', 'exception'].includes(status)) {
        throw new AppError(`Unknown shipment checkpoint status: ${status || '(empty)'}`, 400);
    }

    return {
        eventId,
        trackingId,
        status,
        message: String(parsed?.message || '').slice(0, 300),
        location: String(parsed?.location || '').slice(0, 160),
        at: parsed?.at || new Date().toISOString(),
        payload: parsed,
    };
};

const recordShippingEvent = async ({ eventId, provider, eventType, trackingId, payloadHash, payload, discarded, reason }) => ShippingEvent.create({
    eventId,
    provider,
    eventType,
    trackingId,
    payloadHash,
    payload: {
        ...payload,
        processingMeta: discarded ? { discarded: true, reason } : undefined,
    },
    receivedAt: new Date(),
});

const processShippingWebhook = async ({ provider, signature, rawBody }) => {
    const { valid, unconfigured } = verifyWebhookSignature({ provider, rawBody, signature });
    if (unconfigured) {
        throw new AppError('Shipping webhook receiver is not configured', 503);
    }
    if (!valid) {
        throw new AppError('Invalid shipping webhook signature', 400);
    }

    const event = parseCheckpointEvent(rawBody);

    const existing = await ShippingEvent.findOne({ eventId: event.eventId }).lean();
    if (existing) {
        return { received: true, deduped: true, provider };
    }

    const order = await Order.findOne({ 'shipments.trackingId': event.trackingId })
        .select('_id shipments');

    if (!order) {
        await recordShippingEvent({
            eventId: event.eventId,
            provider,
            eventType: event.status,
            trackingId: event.trackingId,
            payloadHash: hashPayload(event.payload),
            payload: event.payload,
            discarded: true,
            reason: 'tracking_id_not_found',
        });
        return { received: true, deduped: false, discarded: true, reason: 'tracking_id_not_found' };
    }

    const shipment = (order.shipments || []).find((entry) => String(entry.trackingId || '') === event.trackingId);
    if (!shipment) {
        await recordShippingEvent({
            eventId: event.eventId,
            provider,
            eventType: event.status,
            trackingId: event.trackingId,
            payloadHash: hashPayload(event.payload),
            payload: event.payload,
            discarded: true,
            reason: 'shipment_not_found',
        });
        return { received: true, deduped: false, discarded: true, reason: 'shipment_not_found' };
    }

    try {
        await recordShipmentCheckpoint({
            orderId: order._id,
            shipmentId: shipment.shipmentId,
            status: event.status,
            message: event.message,
            location: event.location,
            actor: 'courier',
        });
    } catch (error) {
        // Illegal transitions (e.g. a replayed delivered event) are recorded
        // as discarded instead of failing the webhook with a 5xx.
        if (Number(error?.statusCode) === 409) {
            await recordShippingEvent({
                eventId: event.eventId,
                provider,
                eventType: event.status,
                trackingId: event.trackingId,
                payloadHash: hashPayload(event.payload),
                payload: event.payload,
                discarded: true,
                reason: 'invalid_transition',
            });
            return { received: true, deduped: false, discarded: true, reason: 'invalid_transition' };
        }
        throw error;
    }

    await recordShippingEvent({
        eventId: event.eventId,
        provider,
        eventType: event.status,
        trackingId: event.trackingId,
        payloadHash: hashPayload(event.payload),
        payload: event.payload,
    });
    recordOrderEvent(`courier_${event.status}`);
    logger.info('shipping.webhook_applied', {
        provider,
        eventId: event.eventId,
        trackingId: event.trackingId,
        status: event.status,
        orderId: String(order._id),
    });

    return { received: true, deduped: false, applied: true };
};

module.exports = {
    processShippingWebhook,
    verifyWebhookSignature,
    parseCheckpointEvent,
};
