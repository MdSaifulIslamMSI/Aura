const asyncHandler = require('express-async-handler');
const SupportTicket = require('../models/SupportTicket');
const SupportMessage = require('../models/SupportMessage');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { sendMessageToAdmins, sendMessageToUser } = require('../services/socketService'); // Push via websockets
const { sendPersistentNotification } = require('../services/notificationService');
const { buildProfileSupportUrl } = require('../utils/frontendLinks');

const getPagination = (req) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    return { page, limit, skip };
};

const serializeTicketForAdmin = (ticket) => {
    if (!ticket) return null;

    return {
        _id: String(ticket._id || ''),
        status: String(ticket.status || 'open'),
        subject: String(ticket.subject || ''),
        category: String(ticket.category || ''),
        priority: String(ticket.priority || 'normal'),
        relatedActionId: String(ticket.relatedActionId || ''),
        userActionRequired: Boolean(ticket.userActionRequired),
        lastActorRole: String(ticket.lastActorRole || 'user'),
        resolutionSummary: String(ticket.resolutionSummary || ''),
        resolvedAt: ticket.resolvedAt || null,
        resolvedBy: ticket.resolvedBy || null,
        unreadByUser: Number(ticket.unreadByUser || 0),
        unreadByAdmin: Number(ticket.unreadByAdmin || 0),
        lastMessageAt: ticket.lastMessageAt || null,
        lastMessagePreview: String(ticket.lastMessagePreview || ''),
        createdAt: ticket.createdAt || null,
        updatedAt: ticket.updatedAt || null,
        user: ticket.user
            ? {
                _id: String(ticket.user._id || ''),
                name: String(ticket.user.name || ''),
                email: String(ticket.user.email || ''),
                accountState: String(ticket.user.accountState || 'active'),
            }
            : null,
    };
};

const serializeTicketForUser = (ticket) => {
    if (!ticket) return null;

    return {
        _id: String(ticket._id || ''),
        status: String(ticket.status || 'open'),
        subject: String(ticket.subject || ''),
        category: String(ticket.category || ''),
        priority: String(ticket.priority || 'normal'),
        relatedActionId: String(ticket.relatedActionId || ''),
        userActionRequired: Boolean(ticket.userActionRequired),
        lastActorRole: String(ticket.lastActorRole || 'user'),
        resolutionSummary: String(ticket.resolutionSummary || ''),
        resolvedAt: ticket.resolvedAt || null,
        unreadByUser: Number(ticket.unreadByUser || 0),
        unreadByAdmin: Number(ticket.unreadByAdmin || 0),
        lastMessageAt: ticket.lastMessageAt || null,
        lastMessagePreview: String(ticket.lastMessagePreview || ''),
        createdAt: ticket.createdAt || null,
        updatedAt: ticket.updatedAt || null,
    };
};

const determineTicketPriority = ({ category = '', user = null } = {}) => {
    if (String(category) === 'moderation_appeal' || String(user?.accountState || '') === 'suspended') {
        return 'urgent';
    }

    if (String(category) === 'order_issue') {
        return 'high';
    }

    return 'normal';
};

const buildSupportNotificationPayload = ({
    ticket,
    title,
    message,
    actionLabel = 'Open support',
    priority = 'medium',
    metadata = {},
}) => ({
    title,
    message,
    options: {
        type: 'support',
        priority,
        relatedEntity: ticket?._id || null,
        actionUrl: buildProfileSupportUrl({ ticketId: ticket?._id || '' }),
        actionLabel,
        metadata: {
            ticketId: String(ticket?._id || ''),
            status: String(ticket?.status || 'open'),
            category: String(ticket?.category || ''),
            priority: String(ticket?.priority || 'normal'),
            relatedActionId: String(ticket?.relatedActionId || ''),
            ...metadata,
        },
    },
});

const notifyUserAboutSupportEvent = async (userId, payload = {}) => {
    try {
        await sendPersistentNotification(userId, payload.title, payload.message, payload.options);
    } catch (error) {
        logger.warn('support.user_notification_failed', {
            userId: String(userId || ''),
            title: String(payload?.title || ''),
            reason: error?.message || 'unknown',
        });
    }
};

const loadAdminTicketView = async (ticketId) => {
    const ticket = await SupportTicket.findById(ticketId)
        .populate('user', 'name email accountState')
        .lean();
    return serializeTicketForAdmin(ticket);
};

const emitAdminTicketUpdate = async ({ ticketId, eventName = 'support:ticket:update', message = null }) => {
    try {
        const ticket = await loadAdminTicketView(ticketId);
        if (!ticket) return;

        sendMessageToAdmins(eventName, {
            ticketId: ticket._id,
            ticket,
            ...(message ? { message } : {}),
        });

        if (eventName !== 'support:ticket:update') {
            sendMessageToAdmins('support:ticket:update', {
                ticketId: ticket._id,
                ticket,
            });
        }
    } catch (error) {
        logger.warn('support.admin_realtime_emit_failed', {
            ticketId: String(ticketId || ''),
            eventName,
            reason: error?.message || 'unknown',
        });
    }
};

// @desc    Create a new support ticket
// @route   POST /api/support
// @access  Protected (Active + Suspended)
const createSupportTicket = asyncHandler(async (req, res, next) => {
    const { subject, category, message, relatedActionId } = req.body;
    const priority = determineTicketPriority({ category, user: req.user });

    const ticket = await SupportTicket.create({
        user: req.user._id,
        subject,
        category,
        priority,
        relatedActionId: relatedActionId || '',
        lastMessagePreview: message.substring(0, 150),
        lastActorRole: 'user',
        unreadByAdmin: 1, // Start with 1 unread for admin
    });

    await SupportMessage.create({
        ticket: ticket._id,
        sender: req.user._id,
        text: message,
        isAdmin: false,
        isSystem: false,
    });

    await emitAdminTicketUpdate({
        ticketId: ticket._id,
        eventName: 'support:ticket:new',
    });

    await notifyUserAboutSupportEvent(req.user._id, buildSupportNotificationPayload({
        ticket,
        title: 'Support request created',
        message: `Your ${String(category).replace(/_/g, ' ')} ticket "${subject}" is now open.`,
        actionLabel: 'Open ticket',
        priority: priority === 'urgent' ? 'high' : 'medium',
    }));

    res.status(201).json({
        success: true,
        data: serializeTicketForUser(ticket.toObject()),
    });
});

// @desc    Get user's support tickets
// @route   GET /api/support
// @access  Protected (Active + Suspended)
const getSupportTickets = asyncHandler(async (req, res, next) => {
    const { limit, skip } = getPagination(req);
    
    let filter = { user: req.user._id };
    if (req.query.status) {
        filter.status = req.query.status;
    }

    const tickets = await SupportTicket.find(filter)
        .sort({ lastMessageAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

    const total = await SupportTicket.countDocuments(filter);

    res.json({
        success: true,
        data: tickets.map(serializeTicketForUser),
        pagination: { total, limit, skip },
    });
});

// @desc    Get messages for a support ticket
// @route   GET /api/support/:id/messages
// @access  Protected (Active + Suspended + Admins)
const getSupportTicketMessages = asyncHandler(async (req, res, next) => {
    const ticket = await SupportTicket.findById(req.params.id);

    if (!ticket) {
        return next(new AppError('Support ticket not found', 404));
    }

    if (!req.user.isAdmin && String(ticket.user) !== String(req.user._id)) {
        return next(new AppError('Unauthorized to view this ticket', 403));
    }

    // Clear unread counts
    if (req.user.isAdmin) {
        ticket.unreadByAdmin = 0;
    } else {
        ticket.unreadByUser = 0;
    }
    await ticket.save();

    const messages = await SupportMessage.find({ ticket: ticket._id })
        .sort({ sentAt: 1 })
        .populate('sender', 'name email avatar')
        .lean();

    res.json({
        success: true,
        data: messages,
    });
});

// @desc    Send a message in a support ticket
// @route   POST /api/support/:id/messages
// @access  Protected (Active + Suspended + Admins)
const sendSupportMessage = asyncHandler(async (req, res, next) => {
    const ticket = await SupportTicket.findById(req.params.id);

    if (!ticket) {
        return next(new AppError('Support ticket not found', 404));
    }

    if (!req.user.isAdmin && String(ticket.user) !== String(req.user._id)) {
        return next(new AppError('Unauthorized access to ticket', 403));
    }

    if (ticket.status === 'closed') {
        return next(new AppError('Cannot send messages to a closed ticket', 400));
    }

    const text = req.body.message;
    const isAdmin = Boolean(req.user.isAdmin);

    const message = await SupportMessage.create({
        ticket: ticket._id,
        sender: req.user._id,
        text,
        isAdmin,
        isSystem: false,
    });

    // Update ticket state
    ticket.lastMessageAt = Date.now();
    ticket.lastMessagePreview = text.substring(0, 150);
    ticket.lastActorRole = isAdmin ? 'admin' : 'user';
    if (isAdmin) {
        ticket.unreadByUser += 1;
        ticket.userActionRequired = true;
        if (ticket.status === 'resolved') {
            ticket.status = 'open'; // Reopen on new message
        }
    } else {
        ticket.unreadByAdmin += 1;
        ticket.userActionRequired = false;
    }
    await ticket.save();

    // Populate sender name for the response + websocket
    await message.populate('sender', 'name avatar');

    // Notify via Websocket
    if (isAdmin) {
        // Send to the user who owns the ticket
        try {
            sendMessageToUser(ticket.user, 'support:message:new', {
                ticketId: ticket._id,
                message: message,
            });
        } catch(e) {}

        await notifyUserAboutSupportEvent(ticket.user, buildSupportNotificationPayload({
            ticket,
            title: 'Support replied',
            message: `${req.user?.name || 'Aura Support'} replied to "${ticket.subject}".`,
            actionLabel: 'Review reply',
            priority: ticket.priority === 'urgent' ? 'high' : 'medium',
            metadata: {
                lastMessageAt: message?.sentAt || message?.createdAt || null,
            },
        }));
    }

    await emitAdminTicketUpdate({
        ticketId: ticket._id,
        eventName: 'support:message:new',
        message,
    });

    res.status(201).json({
        success: true,
        data: message,
    });
});

// @desc    Admin programmatic system logging
const addSystemLogToTicket = async (ticketId, text) => {
    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) return null;

    const message = await SupportMessage.create({
        ticket: ticket._id,
        sender: ticket.user, // System logs attached to context of the user, but flagged
        text,
        isAdmin: true,
        isSystem: true,
    });
    
    ticket.lastMessageAt = Date.now();
    ticket.lastMessagePreview = `[System] ${text.substring(0, 50)}...`;
    ticket.lastActorRole = 'system';
    ticket.unreadByUser += 1;
    await ticket.save();

    try {
        sendMessageToUser(ticket.user, 'support:message:new', {
            ticketId: ticket._id,
            message: message,
        });
    } catch(e) {}

    await emitAdminTicketUpdate({
        ticketId: ticket._id,
        eventName: 'support:message:new',
        message,
    });

    return message;
};

// @desc    Admin: get all tickets 
// @route   GET /api/support/admin/all
// @access  Admin
const adminGetTickets = asyncHandler(async (req, res, next) => {
    const { limit, skip } = getPagination(req);
    
    let filter = {};
    if (req.query.status) {
        filter.status = req.query.status;
    }

    const tickets = await SupportTicket.find(filter)
        .sort({ lastMessageAt: -1 })
        .populate('user', 'name email accountState')
        .skip(skip)
        .limit(limit)
        .lean();

    const total = await SupportTicket.countDocuments(filter);

    res.json({
        success: true,
        data: tickets.map(serializeTicketForAdmin),
        pagination: { total, limit, skip },
    });
});

// @desc    Admin: Update ticket status
// @route   PATCH /api/support/:id/status
// @access  Admin
const adminUpdateTicketStatus = asyncHandler(async (req, res, next) => {
    const ticket = await SupportTicket.findById(req.params.id);

    if (!ticket) {
        return next(new AppError('Support ticket not found', 404));
    }

    const nextStatus = req.body.status;
    const resolutionSummary = String(req.body?.resolutionSummary || '').trim();
    const userActionRequired = Boolean(req.body?.userActionRequired);

    ticket.status = nextStatus;
    ticket.userActionRequired = userActionRequired;
    ticket.lastActorRole = 'admin';
    if (resolutionSummary) {
        ticket.resolutionSummary = resolutionSummary;
    } else if (nextStatus === 'open') {
        ticket.resolutionSummary = '';
    }
    if (nextStatus === 'resolved' || nextStatus === 'closed') {
        ticket.resolvedAt = new Date();
        ticket.resolvedBy = req.user._id;
    } else {
        ticket.resolvedAt = null;
        ticket.resolvedBy = null;
    }
    await ticket.save();

    const systemSegments = [`Status updated to ${nextStatus}`];
    if (resolutionSummary) {
        systemSegments.push(`Resolution: ${resolutionSummary}`);
    }
    if (userActionRequired) {
        systemSegments.push('User follow-up requested');
    }
    await addSystemLogToTicket(ticket._id, systemSegments.join(' | '));

    const statusTitles = {
        open: 'Support ticket reopened',
        resolved: 'Support ticket resolved',
        closed: 'Support ticket closed',
    };
    const statusMessages = {
        open: `Aura Support reopened "${ticket.subject}".`,
        resolved: `Aura Support resolved "${ticket.subject}".`,
        closed: `Aura Support closed "${ticket.subject}".`,
    };

    await notifyUserAboutSupportEvent(ticket.user, buildSupportNotificationPayload({
        ticket,
        title: statusTitles[nextStatus] || 'Support ticket updated',
        message: resolutionSummary
            ? `${statusMessages[nextStatus] || `Aura Support updated "${ticket.subject}".`} ${resolutionSummary}`
            : (statusMessages[nextStatus] || `Aura Support updated "${ticket.subject}".`),
        actionLabel: userActionRequired ? 'Review and reply' : 'Review update',
        priority: nextStatus === 'closed' ? 'medium' : 'high',
        metadata: {
            resolutionSummary,
            userActionRequired,
            status: nextStatus,
        },
    }));

    res.json({
        success: true,
        data: serializeTicketForAdmin(ticket.toObject()),
    });
});

module.exports = {
    createSupportTicket,
    getSupportTickets,
    getSupportTicketMessages,
    sendSupportMessage,
    addSystemLogToTicket,
    adminGetTickets,
    adminUpdateTicketStatus
};
