const asyncHandler = require('express-async-handler');
const AdminNotification = require('../models/AdminNotification');
const User = require('../models/User');
const Order = require('../models/Order');
const Listing = require('../models/Listing');
const PaymentIntent = require('../models/PaymentIntent');
const AppError = require('../utils/AppError');

const toInt = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.trunc(parsed);
};

const buildListFilter = (query = {}) => {
    const filter = {};
    if (query.unreadOnly === true || query.unreadOnly === 'true') {
        filter.isRead = false;
    } else if (query.isRead === true || query.isRead === 'true') {
        filter.isRead = true;
    } else if (query.isRead === false || query.isRead === 'false') {
        filter.isRead = false;
    }

    if (query.severity) {
        filter.severity = query.severity;
    }
    if (query.actionKey) {
        filter.actionKey = query.actionKey;
    }
    if (query.entityType) {
        filter.entityType = query.entityType;
    }

    const search = String(query.search || '').trim();
    if (search) {
        filter.$or = [
            { title: { $regex: search, $options: 'i' } },
            { summary: { $regex: search, $options: 'i' } },
            { actorName: { $regex: search, $options: 'i' } },
            { actorEmail: { $regex: search, $options: 'i' } },
            { path: { $regex: search, $options: 'i' } },
        ];
    }

    return filter;
};

const formatNotification = (entry = {}) => ({
    notificationId: entry.notificationId,
    source: entry.source,
    actionKey: entry.actionKey,
    title: entry.title,
    summary: entry.summary,
    severity: entry.severity,
    method: entry.method,
    path: entry.path,
    statusCode: entry.statusCode,
    durationMs: entry.durationMs,
    actor: {
        userId: entry.actorUser ? String(entry.actorUser) : '',
        name: entry.actorName || '',
        email: entry.actorEmail || '',
        role: entry.actorRole || '',
    },
    entityType: entry.entityType || '',
    entityId: entry.entityId || '',
    highlights: Array.isArray(entry.highlights) ? entry.highlights : [],
    requestId: entry.requestId || '',
    isRead: Boolean(entry.isRead),
    readAt: entry.readAt || null,
    createdAt: entry.createdAt || null,
});

const listAdminNotifications = asyncHandler(async (req, res) => {
    const page = Math.max(toInt(req.query.page, 1), 1);
    const limit = Math.min(Math.max(toInt(req.query.limit, 20), 1), 100);
    const skip = (page - 1) * limit;
    const filter = buildListFilter(req.query || {});

    const [total, rows] = await Promise.all([
        AdminNotification.countDocuments(filter),
        AdminNotification.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
    ]);

    res.json({
        success: true,
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
        notifications: rows.map(formatNotification),
    });
});

const getAdminNotificationSummary = asyncHandler(async (req, res) => {
    const now = Date.now();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const last24h = new Date(now - (24 * 60 * 60 * 1000));

    const [
        unreadCount,
        criticalUnreadCount,
        createdToday,
        createdLast24h,
        topActions,
        totalUsers,
        verifiedUsers,
        activeSellers,
        totalOrders,
        totalListings,
        activeListings,
        escrowHeldListings,
        failedPayments,
        pendingPayments,
        latest,
    ] = await Promise.all([
        AdminNotification.countDocuments({ isRead: false }),
        AdminNotification.countDocuments({ isRead: false, severity: 'critical' }),
        AdminNotification.countDocuments({ createdAt: { $gte: todayStart } }),
        AdminNotification.countDocuments({ createdAt: { $gte: last24h } }),
        AdminNotification.aggregate([
            { $match: { createdAt: { $gte: last24h } } },
            { $group: { _id: '$actionKey', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 8 },
        ]),
        User.countDocuments({}),
        User.countDocuments({ isVerified: true }),
        User.countDocuments({ isSeller: true }),
        Order.countDocuments({}),
        Listing.countDocuments({}),
        Listing.countDocuments({ status: 'active' }),
        Listing.countDocuments({ 'escrow.state': 'held' }),
        PaymentIntent.countDocuments({ status: 'failed' }),
        PaymentIntent.countDocuments({ status: { $in: ['created', 'challenge_pending'] } }),
        AdminNotification.find({})
            .sort({ createdAt: -1 })
            .limit(8)
            .lean(),
    ]);

    res.json({
        success: true,
        summary: {
            unreadCount,
            criticalUnreadCount,
            createdToday,
            createdLast24h,
            topActions: topActions.map((item) => ({
                actionKey: item._id,
                count: Number(item.count || 0),
            })),
            operational: {
                users: {
                    total: totalUsers,
                    verified: verifiedUsers,
                    sellers: activeSellers,
                },
                orders: {
                    total: totalOrders,
                },
                listings: {
                    total: totalListings,
                    active: activeListings,
                    escrowHeld: escrowHeldListings,
                },
                payments: {
                    failed: failedPayments,
                    pending: pendingPayments,
                },
            },
            latest: latest.map(formatNotification),
        },
    });
});

const markAdminNotificationRead = asyncHandler(async (req, res, next) => {
    const notification = await AdminNotification.findOne({ notificationId: req.params.notificationId });
    if (!notification) {
        return next(new AppError('Notification not found', 404));
    }

    const readValue = req.body?.read !== undefined ? Boolean(req.body.read) : true;
    notification.isRead = readValue;
    notification.readAt = readValue ? new Date() : null;
    notification.readBy = readValue ? (req.user?._id || null) : null;
    await notification.save();

    res.json({
        success: true,
        notification: formatNotification(notification.toObject()),
    });
});

const markAllAdminNotificationsRead = asyncHandler(async (req, res) => {
    const filter = buildListFilter(req.body || {});
    const result = await AdminNotification.updateMany(
        { ...filter, isRead: false },
        {
            $set: {
                isRead: true,
                readAt: new Date(),
                readBy: req.user?._id || null,
            },
        }
    );

    res.json({
        success: true,
        updated: Number(result.modifiedCount || 0),
    });
});

module.exports = {
    listAdminNotifications,
    getAdminNotificationSummary,
    markAdminNotificationRead,
    markAllAdminNotificationsRead,
};

