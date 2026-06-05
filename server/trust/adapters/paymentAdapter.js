const PaymentEvent = require('../../models/PaymentEvent');
const PaymentIntent = require('../../models/PaymentIntent');

const normalizeText = (value = '') => String(value || '').trim();

const resolveWebhookEventId = (req = {}) => normalizeText(
    req.body?.id
    || req.body?.eventId
    || req.body?.event_id
    || req.body?.data?.object?.id
    || req.headers?.['x-razorpay-event-id']
    || req.headers?.['stripe-event-id']
);

const loadPaymentWebhookResource = (provider = '') => async (req = {}) => {
    const eventId = resolveWebhookEventId(req);
    const existing = eventId
        ? await PaymentEvent.findOne({ eventId }).select('eventId intentId type').lean()
        : null;
    return {
        id: eventId || `${provider || 'payment'}:webhook`,
        eventId,
        type: 'payment_webhook',
        resourceType: 'payment_webhook',
        ownerId: `payment_webhook:${provider || 'unknown'}`,
        state: existing ? 'duplicate' : 'new',
        duplicate: Boolean(existing),
        provider,
        intentId: existing?.intentId || '',
        eventType: req.body?.event || req.body?.type || existing?.type || '',
    };
};

const loadPaymentIntentResource = async (req = {}) => {
    const intentId = normalizeText(req.params?.intentId || req.body?.intentId || req.query?.intentId);
    if (!intentId) return null;
    const intent = await PaymentIntent
        .findOne({ intentId })
        .select('intentId user order status amount currency provider')
        .lean();
    if (!intent) return null;
    return {
        id: intent.intentId,
        intentId: intent.intentId,
        type: 'payment',
        resourceType: 'payment',
        ownerId: String(intent.user || ''),
        userId: String(intent.user || ''),
        state: intent.status || '',
        amount: intent.amount || 0,
        currency: intent.currency || '',
        provider: intent.provider || '',
        orderId: intent.order ? String(intent.order) : '',
    };
};

module.exports = {
    loadPaymentIntentResource,
    loadPaymentWebhookResource,
    resolveWebhookEventId,
};
