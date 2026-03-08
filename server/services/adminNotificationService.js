const AdminNotification = require('../models/AdminNotification');
const logger = require('../utils/logger');

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ADMIN_NOTIFICATION_MAX_HIGHLIGHTS = 5;
const MAX_HIGHLIGHT_LEN = 140;
const MAX_SUMMARY_LEN = 480;

const ACTION_RULES = [
    {
        key: 'auth.login',
        match: (method, path) => method === 'POST' && path === '/api/users/login',
        title: 'User Login',
        summary: 'A user account signed in and synchronized.',
        severity: 'info',
    },
    {
        key: 'profile.updated',
        match: (method, path) => method === 'PUT' && path === '/api/users/profile',
        title: 'Profile Updated',
        summary: 'A user updated account profile details.',
        severity: 'info',
    },
    {
        key: 'order.created',
        match: (method, path) => method === 'POST' && path === '/api/orders',
        title: 'New Order Placed',
        summary: 'A new order was committed by a customer.',
        severity: 'info',
    },
    {
        key: 'order.cancelled',
        match: (method, path) => method === 'POST' && /\/api\/orders\/[^/]+\/cancel$/.test(path),
        title: 'Order Cancelled',
        summary: 'A customer requested order cancellation.',
        severity: 'warning',
    },
    {
        key: 'order.refund.requested',
        match: (method, path) => method === 'POST' && /\/api\/orders\/[^/]+\/command-center\/refund$/.test(path),
        title: 'Refund Requested',
        summary: 'A customer opened a refund request.',
        severity: 'warning',
    },
    {
        key: 'listing.created',
        match: (method, path) => method === 'POST' && path === '/api/listings',
        title: 'Listing Created',
        summary: 'A seller published a new marketplace listing.',
        severity: 'info',
    },
    {
        key: 'listing.updated',
        match: (method, path) => method === 'PUT' && /^\/api\/listings\/[^/]+$/.test(path),
        title: 'Listing Updated',
        summary: 'A seller updated listing details.',
        severity: 'info',
    },
    {
        key: 'listing.deleted',
        match: (method, path) => method === 'DELETE' && /^\/api\/listings\/[^/]+$/.test(path),
        title: 'Listing Deleted',
        summary: 'A listing was removed from marketplace.',
        severity: 'warning',
    },
    {
        key: 'listing.message.sent',
        match: (method, path) => method === 'POST' && /\/api\/listings\/[^/]+\/messages$/.test(path),
        title: 'Marketplace Message',
        summary: 'A buyer or seller sent a marketplace chat message.',
        severity: 'info',
    },
    {
        key: 'seller.activated',
        match: (method, path) => method === 'POST' && ['/api/users/seller/activate', '/api/users/activate-seller', '/api/users/seller/enable'].includes(path),
        title: 'Seller Mode Activated',
        summary: 'A user enabled seller mode.',
        severity: 'warning',
    },
    {
        key: 'seller.deactivated',
        match: (method, path) => method === 'POST' && ['/api/users/seller/deactivate', '/api/users/deactivate-seller', '/api/users/seller/disable'].includes(path),
        title: 'Seller Mode Deactivated',
        summary: 'A seller turned off seller mode.',
        severity: 'warning',
    },
];

const trim = (value) => String(value || '').trim();
const normalizePath = (url = '') => trim(url).split('?')[0] || '/';
const normalizeEmail = (value) => trim(value).toLowerCase();

const summarizePathKey = (path = '') => {
    const normalized = path
        .replace(/\/[a-f0-9]{24}(?=\/|$)/ig, '/:id')
        .replace(/\/\d+(?=\/|$)/g, '/:id')
        .replace(/\/+/g, '/');
    return normalized.replace(/[^a-z0-9:/_-]/gi, '_').toLowerCase();
};

const buildNotificationId = () => `adm_ntf_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const pushHighlight = (items, value) => {
    const normalized = trim(value);
    if (!normalized) return;
    const clipped = normalized.slice(0, MAX_HIGHLIGHT_LEN);
    if (items.includes(clipped)) return;
    items.push(clipped);
};

const getActorRole = (user) => {
    if (!user) return 'guest';
    if (user.isAdmin) return 'admin';
    if (user.isSeller) return 'seller';
    return 'user';
};

const resolveAction = (method, path) => {
    const found = ACTION_RULES.find((rule) => rule.match(method, path));
    if (found) return found;

    const actionSuffix = summarizePathKey(path).replace(/[:/]+/g, '.').replace(/^\.+|\.+$/g, '');
    return {
        key: `generic.${method.toLowerCase()}.${actionSuffix || 'action'}`,
        title: `${method} Action`,
        summary: `A ${method} mutation was completed on ${path}.`,
        severity: 'info',
    };
};

const resolveEntityFromPath = (path) => {
    if (/^\/api\/orders\/[^/]+/.test(path)) {
        const orderId = path.split('/')[3] || '';
        return { entityType: 'order', entityId: orderId };
    }
    if (/^\/api\/listings\/[^/]+/.test(path)) {
        const listingId = path.split('/')[3] || '';
        return { entityType: 'listing', entityId: listingId };
    }
    if (path.startsWith('/api/users/')) {
        return { entityType: 'user', entityId: '' };
    }
    if (path.startsWith('/api/payments/')) {
        return { entityType: 'payment', entityId: '' };
    }
    return { entityType: '', entityId: '' };
};

const buildHighlightsFromRequest = ({ req, path, durationMs }) => {
    const highlights = [];
    const body = req.body || {};

    if (path === '/api/orders' && Array.isArray(body.orderItems)) {
        pushHighlight(highlights, `Order items: ${body.orderItems.length}`);
        if (body.paymentMethod) pushHighlight(highlights, `Payment: ${body.paymentMethod}`);
        if (body.deliveryOption) pushHighlight(highlights, `Delivery: ${body.deliveryOption}`);
    }

    if (path === '/api/listings') {
        if (body.title) pushHighlight(highlights, `Title: ${trim(body.title)}`);
        if (body.category) pushHighlight(highlights, `Category: ${trim(body.category)}`);
        if (body.price !== undefined && body.price !== null) pushHighlight(highlights, `Price: Rs ${Number(body.price || 0).toLocaleString('en-IN')}`);
    }

    if (/\/api\/listings\/[^/]+\/messages$/.test(path) && body.text) {
        pushHighlight(highlights, `Message chars: ${String(body.text).trim().length}`);
    }

    if (path === '/api/users/profile') {
        const fields = Object.keys(body || {}).filter((field) => body[field] !== undefined);
        if (fields.length > 0) {
            pushHighlight(highlights, `Fields: ${fields.join(', ')}`);
        }
    }

    pushHighlight(highlights, `Latency: ${Number(durationMs || 0)} ms`);
    return highlights.slice(0, ADMIN_NOTIFICATION_MAX_HIGHLIGHTS);
};

const shouldSkipNotification = ({ req, res, method, path }) => {
    if (!MUTATION_METHODS.has(method)) return 'not_mutation';
    if (res.statusCode < 200 || res.statusCode >= 400) return 'status_not_success';
    if (path.startsWith('/api/admin/')) return 'admin_portal_action';
    if (path.startsWith('/api/observability/')) return 'observability_ingestion';
    if (req.user?.isAdmin) return 'admin_actor';
    return '';
};

const createAdminNotification = async (payload = {}) => {
    const notification = await AdminNotification.create(payload);
    return notification;
};

const notifyAdminFromRequest = async ({ req, res, durationMs = 0 }) => {
    const method = trim(req.method).toUpperCase();
    const path = normalizePath(req.originalUrl);
    const skipReason = shouldSkipNotification({ req, res, method, path });
    if (skipReason) return { skipped: true, reason: skipReason };

    const action = resolveAction(method, path);
    const actor = req.user || null;
    const actorEmail = normalizeEmail(actor?.email || '');
    const actorName = trim(actor?.name || actorEmail.split('@')[0] || 'Unknown User');
    const { entityType, entityId } = resolveEntityFromPath(path);
    const highlights = buildHighlightsFromRequest({ req, path, durationMs });
    const metadata = {
        requestId: req.requestId || '',
        ip: trim(req.ip || ''),
        userAgent: trim(req.headers['user-agent'] || ''),
        query: req.query || {},
    };

    const notification = await createAdminNotification({
        notificationId: buildNotificationId(),
        source: 'user_action',
        actionKey: action.key,
        title: action.title,
        summary: trim(action.summary).slice(0, MAX_SUMMARY_LEN),
        severity: action.severity || 'info',
        method,
        path,
        statusCode: Number(res.statusCode || 200),
        durationMs: Number(durationMs || 0),
        actorUser: actor?._id || null,
        actorName,
        actorEmail,
        actorRole: getActorRole(actor),
        entityType,
        entityId,
        highlights,
        metadata,
        requestId: req.requestId || '',
    });

    logger.info('admin_notification.created', {
        notificationId: notification.notificationId,
        actionKey: notification.actionKey,
        actorRole: notification.actorRole,
        path,
        method,
        requestId: req.requestId || '',
    });

    return { skipped: false, notificationId: notification.notificationId };
};

module.exports = {
    createAdminNotification,
    notifyAdminFromRequest,
};
