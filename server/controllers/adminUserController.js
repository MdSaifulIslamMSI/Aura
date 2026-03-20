const asyncHandler = require('express-async-handler');
const User = require('../models/User');
const Order = require('../models/Order');
const Listing = require('../models/Listing');
const PaymentIntent = require('../models/PaymentIntent');
const UserGovernanceLog = require('../models/UserGovernanceLog');
const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const { invalidateUserCacheByEmail } = require('../middleware/authMiddleware');
const logger = require('../utils/logger');
const { notifyAdminActionToUser } = require('../services/email/adminActionEmailService');
const { sendMessageToUser } = require('../services/socketService');
const { sendPersistentNotification } = require('../services/notificationService');
const { flags: emailFlags } = require('../config/emailFlags');
const { buildProfileSupportUrl } = require('../utils/frontendLinks');
const {
    createGovernanceAppealTicket,
    resolveLatestGovernanceAppealTicket,
} = require('../services/governanceSupportService');

const USER_ADMIN_PROJECTION = `
name email phone avatar isAdmin isVerified isSeller sellerActivatedAt
accountState softDeleted moderation createdAt updatedAt
`;

const parseBooleanMaybe = (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return undefined;
};

const makeActionId = (prefix = 'ugl') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const sanitizeReason = (value, fallback = '') => {
    const normalized = String(value || '').trim();
    return normalized || fallback;
};

const isCollectionQuotaError = (error) => (
    String(error?.message || '').toLowerCase().includes('cannot create a new collection')
);

const isSuspensionActive = (user) => {
    const until = user?.moderation?.suspendedUntil ? new Date(user.moderation.suspendedUntil) : null;
    return Boolean(until && Number.isFinite(until.getTime()) && until.getTime() > Date.now());
};

const formatAdminUser = (user) => {
    const suspendedUntil = user?.moderation?.suspendedUntil || null;
    const suspensionActive = isSuspensionActive(user);

    return {
        _id: user?._id,
        name: user?.name || '',
        email: user?.email || '',
        phone: user?.phone || '',
        avatar: user?.avatar || '',
        isAdmin: Boolean(user?.isAdmin),
        isVerified: Boolean(user?.isVerified),
        isSeller: Boolean(user?.isSeller),
        sellerActivatedAt: user?.sellerActivatedAt || null,
        accountState: user?.accountState || 'active',
        softDeleted: Boolean(user?.softDeleted),
        moderation: {
            warningCount: Number(user?.moderation?.warningCount || 0),
            lastWarningAt: user?.moderation?.lastWarningAt || null,
            lastWarningReason: user?.moderation?.lastWarningReason || '',
            suspensionCount: Number(user?.moderation?.suspensionCount || 0),
            suspendedAt: user?.moderation?.suspendedAt || null,
            suspendedUntil,
            suspensionReason: user?.moderation?.suspensionReason || '',
            suspensionActive,
            reactivatedAt: user?.moderation?.reactivatedAt || null,
            deletedAt: user?.moderation?.deletedAt || null,
            deleteReason: user?.moderation?.deleteReason || '',
        },
        createdAt: user?.createdAt || null,
        updatedAt: user?.updatedAt || null,
    };
};

const logGovernanceAction = async ({
    actionType,
    targetUser,
    actorUser,
    reason = '',
    metadata = {},
}) => {
    const entry = await UserGovernanceLog.create({
        actionId: makeActionId(),
        actionType,
        targetUser: targetUser._id,
        targetEmail: targetUser.email || '',
        actorUser: actorUser._id,
        actorEmail: actorUser.email || '',
        reason: sanitizeReason(reason, ''),
        metadata,
    });
    return entry;
};

const safeLogGovernanceAction = async (payload = {}) => {
    try {
        return await logGovernanceAction(payload);
    } catch (error) {
        logger.warn('admin.user_governance_log_skipped', {
            requestId: payload?.requestId || '',
            targetUserId: String(payload?.targetUser?._id || ''),
            actorUserId: String(payload?.actorUser?._id || ''),
            actionType: payload?.actionType || '',
            reason: error?.message || 'unknown',
            quotaLimited: isCollectionQuotaError(error),
        });
        return null;
    }
};

const safeNotifyAdminActionToUser = async (payload = {}) => {
    try {
        await notifyAdminActionToUser(payload);
    } catch (error) {
        logger.warn('admin.user_action_email_skipped', {
            requestId: payload?.requestId || '',
            targetUserId: String(payload?.targetUser?._id || ''),
            actionKey: payload?.actionKey || '',
            reason: error?.message || 'unknown',
        });
    }
};

const safeCreateGovernanceAppealTicket = async (payload = {}) => {
    try {
        return await createGovernanceAppealTicket(payload);
    } catch (error) {
        logger.warn('admin.user_governance_ticket_skipped', {
            requestId: payload?.requestId || '',
            targetUserId: String(payload?.targetUser?._id || ''),
            actorUserId: String(payload?.actorUser?._id || ''),
            actionType: payload?.actionType || '',
            reason: error?.message || 'unknown',
        });
        return null;
    }
};

const safeResolveGovernanceAppealTicket = async (payload = {}) => {
    try {
        return await resolveLatestGovernanceAppealTicket(payload);
    } catch (error) {
        logger.warn('admin.user_governance_ticket_resolution_skipped', {
            requestId: payload?.requestId || '',
            targetUserId: String(payload?.targetUser?._id || ''),
            actorUserId: String(payload?.actorUser?._id || ''),
            resolutionType: payload?.resolutionType || '',
            reason: error?.message || 'unknown',
        });
        return null;
    }
};

const buildGovernanceSupportAction = ({ actionId = '', subject = '' } = {}) => ({
    actionUrl: buildProfileSupportUrl({
        compose: true,
        category: 'moderation_appeal',
        relatedActionId: actionId,
        subject,
        intent: 'governance',
    }),
    actionLabel: 'Open appeal',
});

const buildTicketSupportAction = ({ ticketId = '' } = {}) => ({
    actionUrl: buildProfileSupportUrl({
        ticketId,
        intent: 'governance',
    }),
    actionLabel: 'Open case',
});

const buildDeletedAccountRecoveryMailto = ({ actionId = '', subject = '' } = {}) => {
    const inbox = String(emailFlags.orderEmailReplyTo || emailFlags.orderEmailFromAddress || '').trim();
    if (!inbox) return null;

    const params = new URLSearchParams();
    params.set('subject', sanitizeReason(subject, 'Account recovery request'));
    params.set(
        'body',
        [
            'Hello Aura support,',
            '',
            `I need a review for an account disablement${actionId ? ` (action ${actionId})` : ''}.`,
            'Please advise on the next steps.',
        ].join('\n'),
    );

    return {
        actionUrl: `mailto:${inbox}?${params.toString()}`,
        actionLabel: 'Email support',
    };
};

const safeCountDocuments = async ({
    model,
    filter = {},
    requestId = '',
    label = 'unknown',
    fallback = 0,
}) => {
    try {
        return await model.countDocuments(filter);
    } catch (error) {
        logger.warn('admin.user_metric_fallback', {
            requestId,
            label,
            reason: error?.message || 'unknown',
            quotaLimited: isCollectionQuotaError(error),
        });
        return fallback;
    }
};

const safeAggregateAccountStateStats = async ({ requestId = '' } = {}) => {
    try {
        return await User.aggregate([
            { $group: { _id: '$accountState', count: { $sum: 1 } } },
        ]);
    } catch (error) {
        logger.warn('admin.user_state_stats_fallback', {
            requestId,
            reason: error?.message || 'unknown',
            quotaLimited: isCollectionQuotaError(error),
        });
        return [];
    }
};

const safeFetchGovernanceLogs = async ({
    targetUserId,
    requestId = '',
    limit = 100,
}) => {
    try {
        return await UserGovernanceLog.find({ targetUser: targetUserId })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();
    } catch (error) {
        logger.warn('admin.user_governance_log_read_fallback', {
            requestId,
            targetUserId: String(targetUserId || ''),
            reason: error?.message || 'unknown',
            quotaLimited: isCollectionQuotaError(error),
        });
        return [];
    }
};

const guardAdminMutation = ({ targetUser, actorUser }) => {
    if (!targetUser) {
        throw new AppError('Target user not found', 404);
    }
    if (String(targetUser._id) === String(actorUser?._id || '')) {
        throw new AppError('Admin self-moderation is not allowed', 403);
    }
    if (targetUser.isAdmin) {
        throw new AppError('Admin accounts cannot be moderated from this endpoint', 403);
    }
};

// @desc    List users for admin governance
// @route   GET /api/admin/users
// @access  Private/Admin
const listAdminUsers = asyncHandler(async (req, res) => {
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const skip = (page - 1) * limit;
    const filter = {};

    const search = String(req.query.search || '').trim();
    if (search) {
        // CRITICAL: Escape regex special characters to prevent injection
        const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = [
            { name: { $regex: escapedSearch, $options: 'i' } },
            { email: { $regex: escapedSearch, $options: 'i' } },
            { phone: { $regex: escapedSearch, $options: 'i' } },
        ];
    }

    if (req.query.accountState) {
        filter.accountState = String(req.query.accountState).trim();
    }

    const isSeller = parseBooleanMaybe(req.query.isSeller);
    if (isSeller !== undefined) filter.isSeller = isSeller;

    const isVerified = parseBooleanMaybe(req.query.isVerified);
    if (isVerified !== undefined) filter.isVerified = isVerified;

    const isAdmin = parseBooleanMaybe(req.query.isAdmin);
    if (isAdmin !== undefined) filter.isAdmin = isAdmin;

    const [items, total, stateStats] = await Promise.all([
        User.find(filter)
            .select(USER_ADMIN_PROJECTION)
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        User.countDocuments(filter),
        safeAggregateAccountStateStats({ requestId: req.requestId }),
    ]);

    const stats = stateStats.reduce((acc, entry) => {
        acc[String(entry._id || 'unknown')] = Number(entry.count || 0);
        return acc;
    }, {});

    res.json({
        success: true,
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
        stats: {
            active: stats.active || 0,
            warned: stats.warned || 0,
            suspended: stats.suspended || 0,
            deleted: stats.deleted || 0,
        },
        users: items.map(formatAdminUser),
    });
});

// @desc    Get single user governance profile
// @route   GET /api/admin/users/:userId
// @access  Private/Admin
const getAdminUserById = asyncHandler(async (req, res, next) => {
    const user = await User.findById(req.params.userId).select(USER_ADMIN_PROJECTION).lean();
    if (!user) return next(new AppError('User not found', 404));

    const [ordersCount, listingsCount, activeListingsCount, paymentIntentCount, logs] = await Promise.all([
        safeCountDocuments({
            model: Order,
            filter: { user: user._id },
            requestId: req.requestId,
            label: 'orders',
        }),
        safeCountDocuments({
            model: Listing,
            filter: { seller: user._id },
            requestId: req.requestId,
            label: 'listings',
        }),
        safeCountDocuments({
            model: Listing,
            filter: { seller: user._id, status: 'active' },
            requestId: req.requestId,
            label: 'active_listings',
        }),
        safeCountDocuments({
            model: PaymentIntent,
            filter: { user: user._id },
            requestId: req.requestId,
            label: 'payment_intents',
        }),
        safeFetchGovernanceLogs({
            targetUserId: user._id,
            requestId: req.requestId,
        }),
    ]);

    res.json({
        success: true,
        user: formatAdminUser(user),
        metrics: {
            orders: ordersCount,
            listings: listingsCount,
            activeListings: activeListingsCount,
            paymentIntents: paymentIntentCount,
        },
        logs: logs.map((entry) => ({
            actionId: entry.actionId,
            actionType: entry.actionType,
            reason: entry.reason || '',
            actorEmail: entry.actorEmail || '',
            metadata: entry.metadata || {},
            createdAt: entry.createdAt || null,
        })),
    });
});

// @desc    Warn user
// @route   POST /api/admin/users/:userId/warn
// @access  Private/Admin
const warnAdminUser = asyncHandler(async (req, res, next) => {
    const targetUser = await User.findById(req.params.userId);
    guardAdminMutation({ targetUser, actorUser: req.user });

    if (targetUser.accountState === 'deleted' || targetUser.softDeleted) {
        return next(new AppError('Cannot warn a deleted user account', 409));
    }

    const now = new Date();
    const reason = sanitizeReason(req.body.reason, 'Policy warning issued');

    targetUser.moderation = targetUser.moderation || {};
    targetUser.moderation.warningCount = Number(targetUser.moderation.warningCount || 0) + 1;
    targetUser.moderation.lastWarningAt = now;
    targetUser.moderation.lastWarningReason = reason;
    if (targetUser.accountState === 'active' || targetUser.accountState === 'warned') {
        targetUser.accountState = 'warned';
    }
    await targetUser.save();

    const logEntry = await safeLogGovernanceAction({
        actionType: 'warn',
        targetUser,
        actorUser: req.user,
        reason,
        metadata: {
            warningCount: targetUser.moderation.warningCount,
            accountState: targetUser.accountState,
        },
        requestId: req.requestId,
    });
    const appealTicket = await safeCreateGovernanceAppealTicket({
        targetUser,
        actorUser: req.user,
        actionType: 'warn',
        actionId: logEntry?.actionId || '',
        reason,
        requestId: req.requestId,
    });

    invalidateUserCacheByEmail(targetUser.email);
    await safeNotifyAdminActionToUser({
        targetUser,
        actorUser: req.user,
        actionKey: 'admin.user.warn',
        actionTitle: 'Account Warning Issued',
        actionSummary: 'A trust and safety warning was issued on your account by an administrator.',
        highlights: [
            `Reason: ${reason}`,
            `Current account state: ${targetUser.accountState}`,
            `Total warnings: ${targetUser.moderation.warningCount}`,
        ],
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        ...(appealTicket?._id ? buildTicketSupportAction({ ticketId: appealTicket._id }) : buildGovernanceSupportAction({
            actionId: logEntry?.actionId || '',
            subject: 'Appeal account warning',
        })),
    });

    try {
        // Real-time Push & Persistent Notification
        await sendPersistentNotification(targetUser._id, 'Account Warning', `You have received an official warning: ${reason}`, {
            type: 'governance',
            priority: 'high',
            relatedEntity: logEntry?._id,
            metadata: {
                actionType: 'warn',
                actionId: logEntry?.actionId || '',
                accountState: targetUser.accountState,
                supportTicketId: String(appealTicket?._id || ''),
            },
            ...(appealTicket?._id ? buildTicketSupportAction({ ticketId: appealTicket._id }) : buildGovernanceSupportAction({
                actionId: logEntry?.actionId || '',
                subject: 'Appeal account warning',
            })),
        });
    } catch (e) { }

    res.json({
        success: true,
        message: 'User warning issued successfully',
        user: formatAdminUser(targetUser.toObject()),
        workflow: {
            supportTicketId: String(appealTicket?._id || ''),
            userExperience: appealTicket?._id
                ? 'User receives a warning plus a live moderation appeal case.'
                : 'User receives a warning and can open an appeal from support compose.',
        },
    });
});

// @desc    Suspend user
// @route   POST /api/admin/users/:userId/suspend
// @access  Private/Admin
const suspendAdminUser = asyncHandler(async (req, res, next) => {
    const targetUser = await User.findById(req.params.userId);
    guardAdminMutation({ targetUser, actorUser: req.user });

    if (targetUser.accountState === 'deleted' || targetUser.softDeleted) {
        return next(new AppError('Cannot suspend a deleted user account', 409));
    }

    const reason = sanitizeReason(req.body.reason, 'Policy suspension');
    const durationHours = Math.max(Number(req.body.durationHours || 72), 1);
    const now = new Date();
    const suspendedUntil = new Date(now.getTime() + (durationHours * 60 * 60 * 1000));

    targetUser.moderation = targetUser.moderation || {};
    targetUser.accountState = 'suspended';
    targetUser.moderation.suspensionCount = Number(targetUser.moderation.suspensionCount || 0) + 1;
    targetUser.moderation.suspendedAt = now;
    targetUser.moderation.suspendedUntil = suspendedUntil;
    targetUser.moderation.suspensionReason = reason;
    targetUser.moderation.suspendedBy = req.user._id;
    targetUser.isSeller = false;
    targetUser.sellerActivatedAt = null;
    await targetUser.save();

    const listingUpdate = await Listing.updateMany(
        { seller: targetUser._id, status: 'active' },
        { $set: { status: 'expired' } }
    );

    const logEntry = await safeLogGovernanceAction({
        actionType: 'suspend',
        targetUser,
        actorUser: req.user,
        reason,
        metadata: {
            durationHours,
            suspendedUntil: suspendedUntil.toISOString(),
            expiredListings: Number(listingUpdate.modifiedCount || 0),
        },
        requestId: req.requestId,
    });
    const appealTicket = await safeCreateGovernanceAppealTicket({
        targetUser,
        actorUser: req.user,
        actionType: 'suspend',
        actionId: logEntry?.actionId || '',
        reason,
        requestId: req.requestId,
    });

    invalidateUserCacheByEmail(targetUser.email);
    await safeNotifyAdminActionToUser({
        targetUser,
        actorUser: req.user,
        actionKey: 'admin.user.suspend',
        actionTitle: 'Account Suspended',
        actionSummary: 'Your account has been temporarily suspended by an administrator.',
        highlights: [
            `Reason: ${reason}`,
            `Suspended until: ${suspendedUntil.toISOString()}`,
            `Seller mode disabled: yes`,
        ],
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        ...(appealTicket?._id ? buildTicketSupportAction({ ticketId: appealTicket._id }) : buildGovernanceSupportAction({
            actionId: logEntry?.actionId || '',
            subject: 'Appeal account suspension',
        })),
    });

    try {
        // Real-time Push & Persistent Notification
        await sendPersistentNotification(targetUser._id, 'Account Suspended', `Your account has been suspended until ${suspendedUntil.toLocaleDateString()}. Reason: ${reason}`, {
            type: 'governance',
            priority: 'critical',
            relatedEntity: logEntry?._id,
            metadata: {
                actionType: 'suspend',
                actionId: logEntry?.actionId || '',
                accountState: targetUser.accountState,
                suspendedUntil: suspendedUntil.toISOString(),
                supportTicketId: String(appealTicket?._id || ''),
            },
            ...(appealTicket?._id ? buildTicketSupportAction({ ticketId: appealTicket._id }) : buildGovernanceSupportAction({
                actionId: logEntry?.actionId || '',
                subject: 'Appeal account suspension',
            })),
        });
    } catch (e) { }

    res.json({
        success: true,
        message: 'User suspended successfully',
        user: formatAdminUser(targetUser.toObject()),
        workflow: {
            supportTicketId: String(appealTicket?._id || ''),
            userExperience: appealTicket?._id
                ? 'User loses access-sensitive capabilities, active seller listings are disabled, and a priority appeal case opens immediately.'
                : 'User is suspended and can appeal from the support compose path.',
        },
    });
});

// @desc    Dismiss warning
// @route   POST /api/admin/users/:userId/dismiss-warning
// @access  Private/Admin
const dismissAdminUserWarning = asyncHandler(async (req, res, next) => {
    const targetUser = await User.findById(req.params.userId);
    guardAdminMutation({ targetUser, actorUser: req.user });

    if (targetUser.accountState === 'deleted' || targetUser.softDeleted) {
        return next(new AppError('Cannot modify warning for a deleted user account', 409));
    }
    if (targetUser.accountState === 'suspended') {
        return next(new AppError('User is suspended. Reactivate first before dismissing warnings.', 409));
    }

    targetUser.accountState = 'active';
    targetUser.moderation = targetUser.moderation || {};
    targetUser.moderation.lastWarningReason = '';
    await targetUser.save();

    const reason = sanitizeReason(req.body?.reason, 'Warning dismissed by admin');
    const logEntry = await safeLogGovernanceAction({
        actionType: 'dismiss_warning',
        targetUser,
        actorUser: req.user,
        reason,
        metadata: { accountState: targetUser.accountState },
        requestId: req.requestId,
    });
    const resolvedTicket = await safeResolveGovernanceAppealTicket({
        targetUser,
        actorUser: req.user,
        resolutionType: 'dismiss_warning',
        reason,
        requestId: req.requestId,
    });

    invalidateUserCacheByEmail(targetUser.email);
    await safeNotifyAdminActionToUser({
        targetUser,
        actorUser: req.user,
        actionKey: 'admin.user.dismiss_warning',
        actionTitle: 'Account Warning Cleared',
        actionSummary: 'An administrator cleared a warning and restored your account to active state.',
        highlights: [
            `New account state: ${targetUser.accountState}`,
            `Admin note: ${reason}`,
        ],
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        ...(resolvedTicket?._id ? buildTicketSupportAction({ ticketId: resolvedTicket._id }) : {
            actionUrl: '/profile?tab=notifications',
            actionLabel: 'Review update',
        }),
    });

    try {
        // Real-time Push & Persistent Notification
        await sendPersistentNotification(targetUser._id, 'Warning Dismissed', `An official warning on your account has been dismissed. Reason: ${reason}`, {
            type: 'governance',
            priority: 'medium',
            relatedEntity: logEntry?._id,
            metadata: {
                actionType: 'dismiss_warning',
                actionId: logEntry?.actionId || '',
                accountState: targetUser.accountState,
                supportTicketId: String(resolvedTicket?._id || ''),
            },
            ...(resolvedTicket?._id ? buildTicketSupportAction({ ticketId: resolvedTicket._id }) : {
                actionUrl: '/profile?tab=notifications',
                actionLabel: 'Review update',
            }),
        });
    } catch (e) { }

    res.json({
        success: true,
        message: 'User warning dismissed',
        user: formatAdminUser(targetUser.toObject()),
        workflow: {
            supportTicketId: String(resolvedTicket?._id || ''),
            userExperience: resolvedTicket?._id
                ? 'The prior warning case is marked resolved and the user sees a clean resolution trail.'
                : 'The warning is cleared and the user receives the resolution update.',
        },
    });
});

// @desc    Reactivate suspended user
// @route   POST /api/admin/users/:userId/reactivate
// @access  Private/Admin
const reactivateAdminUser = asyncHandler(async (req, res, next) => {
    const targetUser = await User.findById(req.params.userId);
    guardAdminMutation({ targetUser, actorUser: req.user });

    if (targetUser.accountState === 'deleted' || targetUser.softDeleted) {
        return next(new AppError('Deleted user cannot be reactivated from this endpoint', 409));
    }

    targetUser.accountState = 'active';
    targetUser.moderation = targetUser.moderation || {};
    targetUser.moderation.suspendedAt = null;
    targetUser.moderation.suspendedUntil = null;
    targetUser.moderation.suspensionReason = '';
    targetUser.moderation.suspendedBy = null;
    targetUser.moderation.reactivatedAt = new Date();
    targetUser.moderation.reactivatedBy = req.user._id;
    await targetUser.save();

    const reason = sanitizeReason(req.body?.reason, 'User reactivated by admin');
    const logEntry = await safeLogGovernanceAction({
        actionType: 'reactivate',
        targetUser,
        actorUser: req.user,
        reason,
        metadata: { accountState: targetUser.accountState },
        requestId: req.requestId,
    });
    const resolvedTicket = await safeResolveGovernanceAppealTicket({
        targetUser,
        actorUser: req.user,
        resolutionType: 'reactivate',
        reason,
        requestId: req.requestId,
    });

    invalidateUserCacheByEmail(targetUser.email);
    await safeNotifyAdminActionToUser({
        targetUser,
        actorUser: req.user,
        actionKey: 'admin.user.reactivate',
        actionTitle: 'Account Reactivated',
        actionSummary: 'Your account access has been restored by an administrator review.',
        highlights: [
            `New account state: ${targetUser.accountState}`,
            `Admin note: ${reason}`,
        ],
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        ...(resolvedTicket?._id ? buildTicketSupportAction({ ticketId: resolvedTicket._id }) : {
            actionUrl: '/profile?tab=notifications',
            actionLabel: 'Review update',
        }),
    });

    try {
        // Real-time Push & Persistent Notification
        await sendPersistentNotification(targetUser._id, 'Account Reactivated', `Your account suspension has been lifted early. Reason: ${reason}`, {
            type: 'governance',
            priority: 'medium',
            relatedEntity: logEntry?._id,
            metadata: {
                actionType: 'reactivate',
                actionId: logEntry?.actionId || '',
                accountState: targetUser.accountState,
                supportTicketId: String(resolvedTicket?._id || ''),
            },
            ...(resolvedTicket?._id ? buildTicketSupportAction({ ticketId: resolvedTicket._id }) : {
                actionUrl: '/profile?tab=notifications',
                actionLabel: 'Review update',
            }),
        });
    } catch (e) { }

    res.json({
        success: true,
        message: 'User account reactivated',
        user: formatAdminUser(targetUser.toObject()),
        workflow: {
            supportTicketId: String(resolvedTicket?._id || ''),
            userExperience: resolvedTicket?._id
                ? 'The suspension case is resolved, the user regains access, and the outcome stays attached to the moderation thread.'
                : 'The suspension is lifted and the user receives the restoration update.',
        },
    });
});

// @desc    Soft delete user
// @route   POST /api/admin/users/:userId/delete
// @access  Private/Admin
const deleteAdminUser = asyncHandler(async (req, res, next) => {
    const targetUser = await User.findById(req.params.userId);
    guardAdminMutation({ targetUser, actorUser: req.user });

    if (targetUser.accountState === 'deleted' || targetUser.softDeleted) {
        return res.json({
            success: true,
            message: 'User already deleted',
            user: formatAdminUser(targetUser.toObject()),
        });
    }

    const reason = sanitizeReason(req.body.reason, 'Account deleted by admin');
    const scrubPII = Boolean(req.body.scrubPII);
    const now = new Date();

    targetUser.accountState = 'deleted';
    targetUser.softDeleted = true;
    targetUser.isSeller = false;
    targetUser.sellerActivatedAt = null;
    targetUser.moderation = targetUser.moderation || {};
    targetUser.moderation.deletedAt = now;
    targetUser.moderation.deletedBy = req.user._id;
    targetUser.moderation.deleteReason = reason;
    targetUser.moderation.suspendedUntil = null;
    targetUser.moderation.suspensionReason = '';
    targetUser.moderation.suspendedBy = null;

    if (scrubPII) {
        targetUser.name = `Deleted User ${String(targetUser._id).slice(-6)}`;
        targetUser.phone = '';
        targetUser.avatar = '';
        targetUser.bio = '';
        targetUser.addresses = [];
        targetUser.cart = [];
        targetUser.wishlist = [];
    }

    await targetUser.save();

    const listingUpdate = await Listing.updateMany(
        { seller: targetUser._id, status: 'active' },
        { $set: { status: 'expired' } }
    );

    // CRITICAL: Cleanup orphaned orders to prevent data integrity issues
    const orderUpdate = await Order.updateMany(
        { user: targetUser._id },
        { $set: { 'metadata.deletedUser': true, 'metadata.deletedAt': now } }
    );

    const logEntry = await safeLogGovernanceAction({
        actionType: 'delete',
        targetUser,
        actorUser: req.user,
        reason,
        metadata: {
            scrubPII,
            expiredListings: Number(listingUpdate.modifiedCount || 0),
            orphanedOrdersMarked: Number(orderUpdate.modifiedCount || 0),
        },
        requestId: req.requestId,
    });
    const recoveryTicket = await safeCreateGovernanceAppealTicket({
        targetUser,
        actorUser: req.user,
        actionType: 'delete',
        actionId: logEntry?.actionId || '',
        reason,
        requestId: req.requestId,
    });
    const recoveryAction = buildDeletedAccountRecoveryMailto({
        actionId: logEntry?.actionId || '',
        subject: 'Appeal account disablement',
    });

    invalidateUserCacheByEmail(targetUser.email);
    await safeNotifyAdminActionToUser({
        targetUser,
        actorUser: req.user,
        actionKey: 'admin.user.delete',
        actionTitle: 'Account Access Disabled',
        actionSummary: 'Your account was disabled by an administrator action.',
        highlights: [
            `Reason: ${reason}`,
            `PII scrubbed: ${scrubPII ? 'yes' : 'no'}`,
            `Account state: deleted`,
        ],
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        ...(recoveryAction || {}),
    });

    try {
        // Real-time Push & Persistent Notification
        await sendPersistentNotification(targetUser._id, 'Account Deleted', `Your account has been permanently disabled. Contact support if this is an error. Reason: ${reason}`, {
            type: 'governance',
            priority: 'critical',
            relatedEntity: logEntry?._id,
            metadata: {
                actionType: 'delete',
                actionId: logEntry?.actionId || '',
                accountState: targetUser.accountState,
                supportTicketId: String(recoveryTicket?._id || ''),
            },
            ...(recoveryAction || {}),
        });
    } catch (e) { }

    logger.warn('admin.user_soft_deleted', {
        requestId: req.requestId || '',
        targetUserId: String(targetUser._id),
        targetEmail: targetUser.email,
        actorEmail: req.user?.email || '',
        scrubPII,
    });

    res.json({
        success: true,
        message: 'User soft-deleted successfully',
        user: formatAdminUser(targetUser.toObject()),
        workflow: {
            supportTicketId: String(recoveryTicket?._id || ''),
            userExperience: recoveryAction
                ? 'The account is disabled immediately, seller activity is shut down, and the user is directed to dedicated recovery support by email.'
                : 'The account is disabled immediately and the recovery trail stays on the internal moderation case.',
        },
    });
});

module.exports = {
    listAdminUsers,
    getAdminUserById,
    warnAdminUser,
    suspendAdminUser,
    dismissAdminUserWarning,
    reactivateAdminUser,
    deleteAdminUser,
};
