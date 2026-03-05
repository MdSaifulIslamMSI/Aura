const logger = require('../../utils/logger');
const { EMAIL_REGEX } = require('../../config/emailFlags');
const { flags } = require('../../config/activityEmailFlags');
const { sendTransactionalEmail } = require('./index');
const {
    maskIpAddress,
    getDeviceLabelFromUserAgent,
} = require('./templateUtils');
const { renderActivityTemplate } = require('./templates/activityTemplate');

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const cooldownCache = new Map();
let lastPruneAt = 0;

const ACTION_RULES = [
    {
        key: 'auth.login',
        match: (method, path) => method === 'POST' && path === '/api/users/login',
        title: 'Secure Sign-In Confirmed',
        summary: 'Your account session was revalidated and synchronized successfully.',
    },
    {
        key: 'profile.updated',
        match: (method, path) => method === 'PUT' && path === '/api/users/profile',
        title: 'Profile Updated',
        summary: 'Your account profile details were updated.',
    },
    {
        key: 'address.updated',
        match: (method, path) => /^\/api\/users\/addresses(\/|$)/.test(path) && ['POST', 'PUT', 'DELETE'].includes(method),
        title: 'Address Book Changed',
        summary: 'Your saved shipping addresses were modified.',
    },
    {
        key: 'cart.updated',
        match: (method, path) => method === 'PUT' && path === '/api/users/cart',
        title: 'Cart Updated',
        summary: 'Your shopping cart was updated.',
    },
    {
        key: 'wishlist.updated',
        match: (method, path) => method === 'PUT' && path === '/api/users/wishlist',
        title: 'Wishlist Updated',
        summary: 'Your wishlist was updated.',
    },
    {
        key: 'order.created',
        match: (method, path) => method === 'POST' && path === '/api/orders',
        title: 'Order Placement Recorded',
        summary: 'A new order request was accepted and committed to your account.',
    },
    {
        key: 'order.command.refund',
        match: (method, path) => method === 'POST' && /\/api\/orders\/[^/]+\/command-center\/refund$/.test(path),
        title: 'Refund Request Submitted',
        summary: 'A refund request was created from your post-purchase command center.',
    },
    {
        key: 'order.command.replace',
        match: (method, path) => method === 'POST' && /\/api\/orders\/[^/]+\/command-center\/replace$/.test(path),
        title: 'Replacement Request Submitted',
        summary: 'A replacement request was logged from your command center.',
    },
    {
        key: 'order.command.support',
        match: (method, path) => method === 'POST' && /\/api\/orders\/[^/]+\/command-center\/support$/.test(path),
        title: 'Support Message Sent',
        summary: 'A support conversation update was posted for your order.',
    },
    {
        key: 'order.command.warranty',
        match: (method, path) => method === 'POST' && /\/api\/orders\/[^/]+\/command-center\/warranty$/.test(path),
        title: 'Warranty Claim Submitted',
        summary: 'A warranty claim was filed for one of your purchased items.',
    },
    {
        key: 'listing.created',
        match: (method, path) => method === 'POST' && path === '/api/listings',
        title: 'Marketplace Listing Created',
        summary: 'Your new marketplace listing is now live.',
    },
    {
        key: 'listing.updated',
        match: (method, path) => method === 'PUT' && /^\/api\/listings\/[^/]+$/.test(path),
        title: 'Listing Updated',
        summary: 'Your marketplace listing details were updated.',
    },
    {
        key: 'listing.sold',
        match: (method, path) => method === 'PATCH' && /\/api\/listings\/[^/]+\/sold$/.test(path),
        title: 'Listing Marked As Sold',
        summary: 'A listing was marked sold from your seller dashboard.',
    },
    {
        key: 'listing.deleted',
        match: (method, path) => method === 'DELETE' && /^\/api\/listings\/[^/]+$/.test(path),
        title: 'Listing Deleted',
        summary: 'A marketplace listing was permanently removed.',
    },
    {
        key: 'escrow.started',
        match: (method, path) => method === 'PATCH' && /\/api\/listings\/[^/]+\/escrow\/start$/.test(path),
        title: 'Escrow Hold Started',
        summary: 'Escrow hold has been initiated for a marketplace transaction.',
    },
    {
        key: 'escrow.confirmed',
        match: (method, path) => method === 'PATCH' && /\/api\/listings\/[^/]+\/escrow\/confirm$/.test(path),
        title: 'Escrow Delivery Confirmed',
        summary: 'Escrow release was confirmed after delivery.',
    },
    {
        key: 'escrow.cancelled',
        match: (method, path) => method === 'PATCH' && /\/api\/listings\/[^/]+\/escrow\/cancel$/.test(path),
        title: 'Escrow Cancelled',
        summary: 'Escrow hold was cancelled and the transaction state changed.',
    },
    {
        key: 'listing.message.sent',
        match: (method, path) => method === 'POST' && /\/api\/listings\/[^/]+\/messages$/.test(path),
        title: 'Marketplace Message Sent',
        summary: 'A new buyer-seller conversation message was delivered in marketplace chat.',
    },
    {
        key: 'tradein.created',
        match: (method, path) => method === 'POST' && path === '/api/trade-in',
        title: 'Trade-In Request Created',
        summary: 'Your trade-in request has been submitted.',
    },
    {
        key: 'tradein.cancelled',
        match: (method, path) => method === 'DELETE' && /^\/api\/trade-in\/[^/]+$/.test(path),
        title: 'Trade-In Request Cancelled',
        summary: 'A pending trade-in request was cancelled.',
    },
    {
        key: 'pricealert.updated',
        match: (method, path) => method === 'POST' && path === '/api/price-alerts',
        title: 'Price Alert Configured',
        summary: 'A price alert has been created or updated for your watchlist.',
    },
    {
        key: 'pricealert.deleted',
        match: (method, path) => method === 'DELETE' && /^\/api\/price-alerts\/[^/]+$/.test(path),
        title: 'Price Alert Removed',
        summary: 'A price alert rule was removed.',
    },
];

const trim = (value) => String(value || '').trim();
const normalizeEmail = (value) => trim(value).toLowerCase();

const normalizePath = (url = '') => trim(url).split('?')[0] || '/';

const summarizePathKey = (path = '') => {
    const normalized = path
        .replace(/\/[a-f0-9]{24}(?=\/|$)/ig, '/:id')
        .replace(/\/\d+(?=\/|$)/g, '/:id')
        .replace(/\/+/g, '/');
    return normalized.replace(/[^a-z0-9:/_-]/gi, '_').toLowerCase();
};

const isExcludedPath = (path) => (
    Array.isArray(flags.activityEmailExcludedPaths)
    && flags.activityEmailExcludedPaths.some((entry) => {
        const prefix = trim(entry);
        return prefix && path.startsWith(prefix);
    })
);

const resolveAction = (method, path) => {
    const rule = ACTION_RULES.find((candidate) => candidate.match(method, path));
    if (rule) return rule;

    const keyPath = summarizePathKey(path).replace(/[:/]+/g, '.').replace(/^\.+|\.+$/g, '');
    return {
        key: `generic.${method.toLowerCase()}.${keyPath || 'action'}`,
        title: `${method} Action Completed`,
        summary: `A secure ${method} action was completed on your account.`,
    };
};

const formatNumber = (value) => Number(value || 0).toLocaleString('en-IN');
const formatCurrency = (value) => `Rs ${formatNumber(value)}`;

const buildHighlights = ({ req, path, durationMs }) => {
    const highlights = [];
    const body = req.body || {};
    const method = req.method;

    if (path === '/api/users/cart' && Array.isArray(body.cartItems)) {
        const itemCount = body.cartItems.reduce((sum, item) => sum + Number(item?.quantity || 0), 0);
        highlights.push(`Cart items synced: ${formatNumber(body.cartItems.length)} product rows`);
        highlights.push(`Total units in cart: ${formatNumber(itemCount)}`);
    } else if (path === '/api/users/wishlist' && Array.isArray(body.wishlistItems)) {
        highlights.push(`Wishlist items synced: ${formatNumber(body.wishlistItems.length)}`);
    } else if (path === '/api/users/profile' && method === 'PUT') {
        const keys = Object.keys(body).filter((key) => body[key] !== undefined);
        if (keys.length > 0) {
            highlights.push(`Updated fields: ${keys.join(', ')}`);
        }
    } else if (path === '/api/listings' && method === 'POST') {
        if (body.title) highlights.push(`Listing title: ${trim(body.title).slice(0, 100)}`);
        if (body.category) highlights.push(`Category: ${trim(body.category)}`);
        if (body.price !== undefined) highlights.push(`Price: ${formatCurrency(body.price)}`);
        if (Array.isArray(body.images)) highlights.push(`Images submitted: ${formatNumber(body.images.length)}`);
    } else if (path === '/api/orders' && method === 'POST') {
        if (Array.isArray(body.orderItems)) highlights.push(`Order line items: ${formatNumber(body.orderItems.length)}`);
        if (body.paymentMethod) highlights.push(`Payment method: ${trim(body.paymentMethod)}`);
        if (body.deliveryOption) highlights.push(`Delivery option: ${trim(body.deliveryOption)}`);
    } else if (/^\/api\/listings\/[^/]+\/messages$/.test(path) && method === 'POST') {
        if (body.buyerId) highlights.push(`Conversation target: ${trim(body.buyerId).slice(0, 24)}`);
        if (body.text) highlights.push(`Message size: ${formatNumber(String(body.text).trim().length)} chars`);
    }

    highlights.push(`Response latency: ${formatNumber(durationMs)} ms`);
    return highlights.slice(0, flags.activityEmailMaxHighlights);
};

const shouldSkip = ({ req, res, email }) => {
    if (!flags.activityEmailsEnabled) return 'disabled';
    if (!MUTATION_METHODS.has(req.method)) return 'method_not_mutation';
    if (res.statusCode < 200 || res.statusCode >= 400) return 'status_not_success';
    if (!EMAIL_REGEX.test(email)) return 'email_invalid';

    const path = normalizePath(req.originalUrl);
    if (isExcludedPath(path)) return 'path_excluded';

    return '';
};

const shouldSendWithCooldown = ({ email, actionKey }) => {
    const cooldownMs = Number(flags.activityEmailCooldownSec || 0) * 1000;
    if (cooldownMs <= 0) return true;

    const now = Date.now();
    const cacheKey = `${email}::${actionKey}`;
    const last = cooldownCache.get(cacheKey) || 0;
    if (now - last < cooldownMs) return false;

    cooldownCache.set(cacheKey, now);
    if (now - lastPruneAt > 10 * 60 * 1000) {
        lastPruneAt = now;
        for (const [key, timestamp] of cooldownCache.entries()) {
            if (now - timestamp > cooldownMs * 2) {
                cooldownCache.delete(key);
            }
        }
    }

    return true;
};

const notifyActivityFromRequest = async ({ req, res, durationMs = 0 }) => {
    const email = normalizeEmail(req.user?.email || '');
    const skipReason = shouldSkip({ req, res, email });
    if (skipReason) return { skipped: true, reason: skipReason };

    const path = normalizePath(req.originalUrl);
    const action = resolveAction(req.method, path);

    if (!shouldSendWithCooldown({ email, actionKey: action.key })) {
        return { skipped: true, reason: 'cooldown' };
    }

    const template = renderActivityTemplate({
        brand: 'AURA',
        userName: req.user?.name || email.split('@')[0] || 'there',
        actionTitle: action.title,
        actionSummary: action.summary,
        highlights: buildHighlights({ req, path, durationMs }),
        requestId: req.requestId || req.headers['x-request-id'] || '',
        method: req.method,
        path,
        deviceLabel: getDeviceLabelFromUserAgent(req.headers['user-agent']),
        maskedIp: maskIpAddress(req.ip),
        occurredAt: new Date(),
        ctaUrl: flags.activityEmailCtaUrl,
    });

    await sendTransactionalEmail({
        eventType: 'user_activity',
        to: email,
        subject: template.subject,
        html: template.html,
        text: template.text,
        requestId: req.requestId || req.headers['x-request-id'] || '',
        headers: {
            'X-Aura-Activity-Key': action.key.slice(0, 120),
            'X-Aura-Activity-Method': req.method,
            'X-Aura-Activity-Path': path.slice(0, 220),
        },
        meta: {
            actionKey: action.key,
            method: req.method,
            path,
            statusCode: res.statusCode,
            durationMs,
            userId: String(req.user?._id || ''),
        },
        securityTags: ['user-activity', action.key, req.method.toLowerCase()],
    });

    logger.info('activity_email.sent', {
        requestId: req.requestId || '',
        email: email.replace(/(.{2}).*(@.*)/, '$1***$2'),
        actionKey: action.key,
        statusCode: res.statusCode,
    });

    return { skipped: false };
};

module.exports = {
    notifyActivityFromRequest,
};
