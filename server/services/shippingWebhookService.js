const crypto = require('crypto');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const Order = require('../models/Order');
const ShippingEvent = require('../models/ShippingEvent');
const { recordShipmentCheckpoint, canTransitionShipmentStatus } = require('./orderService');
const { isEnabled: isEmergencyFlagEnabled } = require('./emergencyControlService');
const { recordOrderEvent } = require('../middleware/metrics');

const shouldSuppressShippingMutation = async () => {
    try {
        const [maintenance, readOnly, paymentDisabled] = await Promise.all([
            isEmergencyFlagEnabled('GLOBAL_MAINTENANCE', { failClosed: true }),
            isEmergencyFlagEnabled('READ_ONLY_MODE', { failClosed: true }),
            isEmergencyFlagEnabled('DISABLE_PAYMENT', { failClosed: true }),
        ]);
        return maintenance || readOnly || paymentDisabled;
    } catch (error) {
        // Matching the payment webhook contract: an unreadable emergency state
        // is not permission to write order state.
        logger.error('shipping.webhook_emergency_eval_failed_closed', {
            error: error?.message || 'unknown',
        });
        return true;
    }
};

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

const recordShippingEvent = async ({
    eventId,
    provider,
    eventType,
    trackingId,
    payloadHash,
    payload,
    discarded,
    suppressed,
    reason,
}) => {
    let processingMeta;
    if (discarded) {
        processingMeta = { discarded: true, reason };
    } else if (suppressed) {
        processingMeta = { suppressed: true, reason };
    }
    try {
        return await ShippingEvent.create({
            eventId,
            provider,
            eventType,
            trackingId,
            payloadHash,
            payload: {
                ...payload,
                processingMeta,
            },
            receivedAt: new Date(),
        });
    } catch (error) {
        // Concurrent provider retries race the ledger lookup; the unique
        // eventId is the authoritative dedupe, so the loser is a no-op.
        if (error?.code === 11000) return null;
        throw error;
    }
};

const isSuppressedEvent = (event) => (
    event?.payload?.processingMeta?.suppressed === true
    && !event?.payload?.processingMeta?.replayedAt
);

const markShippingEventReplayOutcome = async ({ eventId, outcome, reason = '' }) => {
    try {
        await ShippingEvent.updateOne(
            { eventId },
            {
                $set: {
                    'payload.processingMeta': {
                        suppressed: true,
                        replayedAt: new Date(),
                        outcome,
                        ...(reason ? { reason } : {}),
                    },
                },
            }
        );
    } catch (error) {
        logger.warn('shipping.webhook_replay_marker_failed', {
            eventId,
            outcome,
            error: error?.message || 'unknown',
        });
    }
};

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
    const replayingSuppressed = isSuppressedEvent(existing);
    if (existing && !replayingSuppressed) {
        return { received: true, deduped: true, provider };
    }

    if (await shouldSuppressShippingMutation()) {
        if (replayingSuppressed) {
            return { received: true, deduped: true, provider, suppressed: true };
        }
        await recordShippingEvent({
            eventId: event.eventId,
            provider,
            eventType: event.status,
            trackingId: event.trackingId,
            payloadHash: hashPayload(event.payload),
            payload: event.payload,
            suppressed: true,
            reason: 'emergency_shipping_mutations_disabled',
        });
        logger.warn('shipping.webhook_mutation_suppressed_by_emergency', {
            provider,
            eventId: event.eventId,
            trackingId: event.trackingId,
            status: event.status,
        });
        return {
            received: true,
            deduped: false,
            suppressed: true,
            reason: 'emergency_shipping_mutations_disabled',
        };
    }

    const order = await Order.findOne({ 'shipments.trackingId': event.trackingId })
        .select('_id shipments');

    if (!order) {
        if (replayingSuppressed) {
            await markShippingEventReplayOutcome({
                eventId: event.eventId,
                outcome: 'discarded',
                reason: 'tracking_id_not_found',
            });
        } else {
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
        }
        return { received: true, deduped: false, discarded: true, reason: 'tracking_id_not_found' };
    }

    const shipment = (order.shipments || []).find((entry) => String(entry.trackingId || '') === event.trackingId);
    if (!shipment) {
        if (replayingSuppressed) {
            await markShippingEventReplayOutcome({
                eventId: event.eventId,
                outcome: 'discarded',
                reason: 'shipment_not_found',
            });
        } else {
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
        }
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
            if (replayingSuppressed) {
                await markShippingEventReplayOutcome({
                    eventId: event.eventId,
                    outcome: 'discarded',
                    reason: 'invalid_transition',
                });
            } else {
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
            }
            return { received: true, deduped: false, discarded: true, reason: 'invalid_transition' };
        }
        throw error;
    }

    if (replayingSuppressed) {
        await markShippingEventReplayOutcome({
            eventId: event.eventId,
            outcome: 'applied',
        });
    } else {
        await recordShippingEvent({
            eventId: event.eventId,
            provider,
            eventType: event.status,
            trackingId: event.trackingId,
            payloadHash: hashPayload(event.payload),
            payload: event.payload,
        });
    }
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
