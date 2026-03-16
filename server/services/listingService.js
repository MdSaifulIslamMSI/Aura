const Listing = require('../models/Listing');
const User = require('../models/User');
const PaymentIntent = require('../models/PaymentIntent');
const PaymentEvent = require('../models/PaymentEvent');
const AppError = require('../utils/AppError');
const { sendTransactionalEmail } = require('./email');
const { renderActivityTemplate } = require('./email/templates/activityTemplate');
const {
    maskIpAddress,
    getDeviceLabelFromUserAgent,
} = require('./email/templateUtils');
const { makeEventId } = require('./payments/helpers');
const { flags: paymentFlags } = require('../config/paymentFlags');
const crypto = require('crypto');

const SELLER_PUBLIC_STRICT = 'name createdAt isVerified';
const SELLER_PRIVATE_THREAD = 'name email phone createdAt isVerified';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Serializes a conversation thread for a specific viewer
 */
const serializeThreadForUser = ({
    listing,
    thread,
    viewerId,
    sellerUser = null,
    buyerUser = null,
}) => {
    const viewer = String(viewerId || '');
    const sellerId = String(listing?.seller?._id || listing?.seller || '');
    const buyerId = String(thread?.buyer || '');
    const viewerIsSeller = viewer && viewer === sellerId;
    const unreadCount = viewerIsSeller
        ? Number(thread?.unreadBySeller || 0)
        : Number(thread?.unreadByBuyer || 0);

    const counterpartUser = viewerIsSeller ? buyerUser : sellerUser;
    const counterpartId = viewerIsSeller ? buyerId : sellerId;

    return {
        listingId: String(listing?._id || ''),
        listingTitle: listing?.title || '',
        listingPrice: Number(listing?.price || 0),
        listingImage: Array.isArray(listing?.images) ? (listing.images[0] || '') : '',
        listingStatus: listing?.status || 'active',
        buyerId,
        sellerId,
        unreadCount,
        lastMessageAt: thread?.lastMessageAt || null,
        lastMessagePreview: thread?.lastMessagePreview || '',
        counterpart: {
            id: counterpartId,
            name: counterpartUser?.name || '',
            email: counterpartUser?.email || '',
            avatar: counterpartUser?.avatar || '',
            isVerified: Boolean(counterpartUser?.isVerified),
        },
        messages: Array.isArray(thread?.messages)
            ? thread.messages.map((message) => {
                const senderId = String(message?.sender?._id || message?.sender || '');
                return {
                    id: String(message?._id || ''),
                    text: message?.text || '',
                    sentAt: message?.sentAt || null,
                    readAt: message?.readAt || null,
                    senderRole: message?.senderRole || '',
                    senderId,
                    isMine: Boolean(senderId && senderId === viewer),
                };
            })
            : [],
    };
};

/**
 * Sends an email notification to the counterparty in a marketplace message thread
 */
const sendCounterpartyMessageEmail = async ({
    recipientEmail,
    recipientName,
    actorName,
    listing,
    messageText,
    req,
}) => {
    if (!EMAIL_REGEX.test(String(recipientEmail || '').trim().toLowerCase())) {
        return;
    }

    const template = renderActivityTemplate({
        brand: 'AURA',
        userName: recipientName || 'there',
        actionTitle: 'New Marketplace Message',
        actionSummary: `${actorName || 'A marketplace user'} sent you a new message on a listing.`,
        highlights: [
            `Listing: ${String(listing?.title || '').slice(0, 100)}`,
            `Message preview: ${String(messageText || '').slice(0, 120)}`,
            `Price: Rs ${Number(listing?.price || 0).toLocaleString('en-IN')}`,
            'Open Aura Marketplace to reply in the persistent listing chat.',
        ],
        requestId: req.requestId || req.headers['x-request-id'] || '',
        method: req.method,
        path: req.originalUrl,
        deviceLabel: getDeviceLabelFromUserAgent(req.headers['user-agent']),
        maskedIp: maskIpAddress(req.ip),
        occurredAt: new Date(),
        ctaUrl: '/marketplace',
    });

    await sendTransactionalEmail({
        eventType: 'user_activity',
        to: recipientEmail,
        subject: template.subject,
        html: template.html,
        text: template.text,
        requestId: req.requestId || req.headers['x-request-id'] || '',
        headers: {
            'X-Aura-Activity-Key': 'listing.message.received',
            'X-Aura-Activity-Method': req.method,
            'X-Aura-Activity-Path': '/api/listings/:id/messages',
        },
        meta: {
            actionKey: 'listing.message.received',
            listingId: String(listing?._id || ''),
            actorName: actorName || '',
        },
        securityTags: ['user-activity', 'listing.message.received'],
    });
};

/**
 * Validates if a user is eligible to start an escrow on a listing
 */
const assertEscrowEligibility = ({ listing, userId, allowHeld = false }) => {
    if (!listing) {
        throw new AppError('Listing not found', 404);
    }
    if (listing.status !== 'active') {
        throw new AppError('Escrow can only be started for active listings', 409);
    }
    if (!listing.escrowOptIn) {
        throw new AppError('Seller has not enabled escrow mode for this listing', 409);
    }
    if (String(listing.seller?._id || listing.seller) === String(userId)) {
        throw new AppError('Seller cannot start escrow on own listing', 403);
    }
    if (!allowHeld && listing.escrow?.state === 'held') {
        throw new AppError('Escrow is already active for this listing', 409);
    }
};

/**
 * Builds the checkout payload for escrow payments
 */
const buildEscrowCheckoutPayload = ({
    providerOrderId,
    amount,
    currency,
    user,
}) => {
    if (paymentFlags.paymentProvider === 'razorpay') {
        return {
            key: process.env.RAZORPAY_KEY_ID || '',
            orderId: providerOrderId,
            amount,
            currency,
            name: 'Aura Marketplace',
            description: 'Aura Marketplace Escrow Hold',
            prefill: {
                name: user?.name || '',
                email: user?.email || '',
                contact: user?.phone || '',
            },
            theme: { color: '#06b6d4' },
        };
    }

    const simulatedPaymentId = makeEventId('sim_pay');
    // Using a hash of the prompt for "privacy" in the simulation
    const simulatedSignature = `sim_${crypto.createHash('sha1').update(`${providerOrderId}|${simulatedPaymentId}`).digest('hex').slice(0, 14)}`;
    return {
        key: 'simulated',
        orderId: providerOrderId,
        amount,
        currency,
        simulatedConfirm: {
            providerPaymentId: simulatedPaymentId,
            providerOrderId,
            providerSignature: simulatedSignature,
        },
    };
};

/**
 * Appends a payment event related to escrow
 */
const appendEscrowPaymentEvent = async ({
    intentId,
    source,
    type,
    payload = {},
}) => {
    // Simple hash function for payload integrity in logs
    const hashPayload = (p) => crypto.createHash('md5').update(JSON.stringify(p)).digest('hex').slice(0, 8);

    await PaymentEvent.create({
        eventId: makeEventId('evt'),
        intentId,
        source,
        type,
        payloadHash: hashPayload(payload),
        payload,
        receivedAt: new Date(),
    });
};

module.exports = {
    serializeThreadForUser,
    sendCounterpartyMessageEmail,
    assertEscrowEligibility,
    buildEscrowCheckoutPayload,
    appendEscrowPaymentEvent,
    SELLER_PUBLIC_STRICT,
    SELLER_PRIVATE_THREAD,
};
