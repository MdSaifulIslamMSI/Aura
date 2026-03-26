const asyncHandler = require('express-async-handler');
const SupportTicket = require('../models/SupportTicket');
const SupportMessage = require('../models/SupportMessage');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const {
    clearSupportVideoSession,
    emitSupportRealtimeUpdate,
    getSupportVideoSession,
    markSupportVideoSessionConnected,
    registerSupportVideoSession,
    sendMessageToAdmins,
    sendMessageToUser,
} = require('../services/socketService'); // Push via websockets
const { sendPersistentNotification } = require('../services/notificationService');
const { buildProfileSupportUrl } = require('../utils/frontendLinks');
const {
    loadAdminTicketView,
    loadUserTicketView,
    serializeTicketForAdmin,
    serializeTicketForUser,
} = require('../services/supportTicketViews');
const {
    markSupportTicketLiveCallConnected,
    markSupportTicketLiveCallEnded,
    markSupportTicketLiveCallStarted,
    requestSupportTicketLiveCall,
} = require('../services/supportVideoService');
const {
    buildSupportRoomName,
    createSupportParticipantSession,
    deleteSupportRoom,
    ensureSupportRoom,
} = require('../services/livekitService');

const getPagination = (req) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    return { page, limit, skip };
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

const loadSupportTicketForSession = async (ticketId) => {
    const ticket = await SupportTicket.findById(ticketId).populate('user', 'name email accountState');
    if (!ticket) {
        throw new AppError('Support ticket not found', 404);
    }
    return ticket;
};

const ensureSupportTicketViewer = (ticket, user) => {
    if (!ticket?._id) {
        throw new AppError('Support ticket not found', 404);
    }

    const isAdmin = Boolean(user?.isAdmin);
    const isOwner = String(ticket.user?._id || ticket.user || '') === String(user?._id || '');
    if (!isAdmin && !isOwner) {
        throw new AppError('Unauthorized access to ticket', 403);
    }

    return {
        isAdmin,
        isOwner,
        ticketOwnerId: String(ticket.user?._id || ticket.user || ''),
    };
};

const normalizeLiveCallMediaMode = (value) => (
    String(value || '').trim().toLowerCase() === 'voice' ? 'voice' : 'video'
);
const getSupportCallModeLabel = (mediaMode = 'video') => (
    normalizeLiveCallMediaMode(mediaMode) === 'voice' ? 'voice call' : 'video call'
);
const buildSupportLiveCallLabel = (ticket, mediaMode = 'video') => (
    normalizeLiveCallMediaMode(mediaMode) === 'voice'
        ? `Aura Support voice call for "${String(ticket?.subject || 'support ticket')}"`
        : `Aura Support live call for "${String(ticket?.subject || 'support ticket')}"`
);

const buildSupportLiveCallMeta = ({ session, ticket }) => ({
    liveCall: {
        ...session,
        channelType: 'support_ticket',
        contextId: String(ticket?._id || ''),
        supportTicketId: String(ticket?._id || ''),
        contextLabel: String(session?.contextLabel || buildSupportLiveCallLabel(ticket, session?.mediaMode)),
        mediaMode: normalizeLiveCallMediaMode(session?.mediaMode),
    },
});

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

// @desc    Request a live support call on an existing ticket
// @route   POST /api/support/:id/video/request
// @access  Protected (Active + Suspended + Admins)
const requestSupportLiveCall = asyncHandler(async (req, res, next) => {
    const ticket = await SupportTicket.findById(req.params.id);

    if (!ticket) {
        return next(new AppError('Support ticket not found', 404));
    }

    const isAdmin = Boolean(req.user.isAdmin);
    if (!isAdmin && String(ticket.user) !== String(req.user._id)) {
        return next(new AppError('Unauthorized access to ticket', 403));
    }

    if (ticket.status === 'closed') {
        return next(new AppError('Closed tickets cannot request live support calls', 400));
    }

    const note = String(req.body?.note || '').trim();
    const mediaMode = normalizeLiveCallMediaMode(req.body?.mediaMode);
    const modeLabel = getSupportCallModeLabel(mediaMode);
    const { ticket: updatedTicket, message } = await requestSupportTicketLiveCall({
        ticketId: ticket._id,
        requesterUserId: req.user._id,
        requesterRole: isAdmin ? 'admin' : 'user',
        note,
        mediaMode,
    });

    await emitAdminTicketUpdate({
        ticketId: updatedTicket._id,
        eventName: 'support:message:new',
        message,
    });

    if (!isAdmin) {
        sendMessageToAdmins('support:ticket:video_requested', {
            ticketId: String(updatedTicket._id),
            ticket: await loadAdminTicketView(updatedTicket._id),
            message,
        });
    } else {
        try {
            sendMessageToUser(updatedTicket.user, 'support:ticket:update', {
                ticketId: String(updatedTicket._id),
                ticket: serializeTicketForUser(updatedTicket.toObject()),
            });
            if (message) {
                sendMessageToUser(updatedTicket.user, 'support:message:new', {
                    ticketId: String(updatedTicket._id),
                    message,
                    ticket: serializeTicketForUser(updatedTicket.toObject()),
                });
            }
        } catch (error) {
            logger.warn('support.user_realtime_emit_failed', {
                ticketId: String(updatedTicket._id),
                reason: error?.message || 'unknown',
            });
        }
    }

    if (isAdmin) {
        await notifyUserAboutSupportEvent(updatedTicket.user, buildSupportNotificationPayload({
            ticket: updatedTicket,
            title: `Aura Support requested a ${modeLabel}`,
            message: `Aura Support requested a ${modeLabel} for "${updatedTicket.subject}".`,
            actionLabel: 'Open support thread',
            priority: updatedTicket.priority === 'urgent' ? 'high' : 'medium',
            metadata: {
                liveCallRequested: true,
                liveCallRequestedByRole: 'admin',
                liveCallMediaMode: mediaMode,
            },
        }));
    }

    res.status(201).json({
        success: true,
        data: isAdmin
            ? serializeTicketForAdmin(updatedTicket.toObject())
            : serializeTicketForUser(updatedTicket.toObject()),
        meta: {
            liveCallRequested: true,
            mediaMode,
        },
    });
});

// @desc    Admin: start or rejoin a LiveKit support session
// @route   POST /api/support/:id/video/start
// @access  Admin
const startSupportLiveCallSession = asyncHandler(async (req, res, next) => {
    const ticket = await loadSupportTicketForSession(req.params.id);
    const { isAdmin, ticketOwnerId } = ensureSupportTicketViewer(ticket, req.user);

    if (!isAdmin) {
        return next(new AppError('Only Aura Support can start live calls', 403));
    }

    if (ticket.status === 'closed') {
        return next(new AppError('Closed tickets cannot start live support calls', 400));
    }

    const currentStatus = String(ticket.liveCallLastStatus || '');
    const hasActiveSession = Boolean(
        ['ringing', 'connected'].includes(currentStatus)
        && String(ticket.liveCallLastSessionKey || '').trim()
    );
    const existingSession = getSupportVideoSession(ticket._id);
    const mediaMode = normalizeLiveCallMediaMode(
        req.body?.mediaMode
        || existingSession?.mediaMode
        || ticket.liveCallLastMediaMode
        || ticket.liveCallRequestedMode
    );
    const modeLabel = getSupportCallModeLabel(mediaMode);

    if (
        hasActiveSession
        && ticket.liveCallStartedBy
        && String(ticket.liveCallStartedBy) !== String(req.user._id)
    ) {
        return next(new AppError('Another support agent already owns this live call', 409));
    }

    const contextLabel = buildSupportLiveCallLabel(ticket, mediaMode);
    const roomName = hasActiveSession
        ? String(ticket.liveCallLastSessionKey || '').trim()
        : buildSupportRoomName(ticket._id);

    await ensureSupportRoom(roomName, {
        supportTicketId: String(ticket._id),
        channelType: 'support_ticket',
        subject: String(ticket.subject || ''),
    });

    if (!hasActiveSession) {
        const supportCallUpdate = await markSupportTicketLiveCallStarted({
            ticketId: ticket._id,
            startedByUserId: req.user._id,
            startedByRole: 'admin',
            sessionKey: roomName,
            contextLabel,
            mediaMode,
        });

        await emitSupportRealtimeUpdate({
            ticketId: ticket._id,
            eventName: 'support:message:new',
            message: supportCallUpdate?.message || null,
        });

        sendMessageToUser(ticketOwnerId, 'support:video:incoming', {
            fromUserId: String(req.user._id),
            fromName: String(req.user?.name || 'Aura Support'),
            supportTicketId: String(ticket._id),
            channelType: 'support_ticket',
            contextId: String(ticket._id),
            contextLabel,
            sessionKey: roomName,
            mediaMode,
        });

        await notifyUserAboutSupportEvent(ticketOwnerId, buildSupportNotificationPayload({
            ticket,
            title: `Aura Support started a ${modeLabel}`,
            message: `Aura Support started a ${modeLabel} for "${ticket.subject}".`,
            actionLabel: 'Join live call',
            priority: ticket.priority === 'urgent' ? 'high' : 'medium',
            metadata: {
                liveCallSessionKey: roomName,
                liveCallStatus: 'ringing',
                liveCallMediaMode: mediaMode,
            },
        }));
    }

    registerSupportVideoSession({
        ticketId: ticket._id,
        sessionKey: roomName,
        roomName,
        userId: ticketOwnerId,
        adminUserId: req.user._id,
        contextLabel,
        status: currentStatus === 'connected' ? 'connected' : 'ringing',
        mediaMode,
    });

    const session = await createSupportParticipantSession({
        ticketId: ticket._id,
        roomName,
        role: 'admin',
        user: req.user,
        contextLabel,
    });

    res.status(hasActiveSession ? 200 : 201).json({
        success: true,
        data: await loadAdminTicketView(ticket._id),
        meta: buildSupportLiveCallMeta({
            session: {
                ...session,
                mediaMode,
            },
            ticket,
        }),
    });
});

// @desc    Join an active LiveKit support session
// @route   POST /api/support/:id/video/join
// @access  Protected (ticket owner or assigned admin)
const joinSupportLiveCallSession = asyncHandler(async (req, res, next) => {
    const ticket = await loadSupportTicketForSession(req.params.id);
    const { isAdmin, ticketOwnerId } = ensureSupportTicketViewer(ticket, req.user);
    const sessionState = getSupportVideoSession(ticket._id);
    const sessionKey = String(
        req.body?.sessionKey
        || sessionState?.sessionKey
        || ticket.liveCallLastSessionKey
        || ''
    ).trim();
    const lastStatus = String(ticket.liveCallLastStatus || '');

    if (!sessionKey || !['ringing', 'connected'].includes(lastStatus)) {
        return next(new AppError('There is no active live support call to join', 409));
    }

    if (
        isAdmin
        && ticket.liveCallStartedBy
        && String(ticket.liveCallStartedBy) !== String(req.user._id)
    ) {
        return next(new AppError('Another support agent already owns this live call', 409));
    }

    const mediaMode = normalizeLiveCallMediaMode(
        req.body?.mediaMode
        || sessionState?.mediaMode
        || ticket.liveCallLastMediaMode
        || ticket.liveCallRequestedMode
    );
    const contextLabel = String(ticket.liveCallLastContextLabel || buildSupportLiveCallLabel(ticket, mediaMode)).trim()
        || buildSupportLiveCallLabel(ticket, mediaMode);

    await ensureSupportRoom(sessionKey, {
        supportTicketId: String(ticket._id),
        channelType: 'support_ticket',
        subject: String(ticket.subject || ''),
    });

    registerSupportVideoSession({
        ticketId: ticket._id,
        sessionKey,
        roomName: sessionKey,
        userId: ticketOwnerId,
        adminUserId: sessionState?.adminUserId || ticket.liveCallStartedBy || req.user._id,
        contextLabel,
        status: lastStatus === 'connected' ? 'connected' : 'ringing',
        mediaMode,
    });

    const session = await createSupportParticipantSession({
        ticketId: ticket._id,
        roomName: sessionKey,
        role: isAdmin ? 'admin' : 'user',
        user: req.user,
        contextLabel,
    });

    res.json({
        success: true,
        data: isAdmin
            ? await loadAdminTicketView(ticket._id)
            : await loadUserTicketView(ticket._id),
        meta: buildSupportLiveCallMeta({
            session: {
                ...session,
                mediaMode,
            },
            ticket,
        }),
    });
});

// @desc    Mark an active LiveKit support session as connected
// @route   POST /api/support/:id/video/connected
// @access  Protected (ticket owner or assigned admin)
const connectSupportLiveCallSession = asyncHandler(async (req, res, next) => {
    const ticket = await loadSupportTicketForSession(req.params.id);
    const { isAdmin } = ensureSupportTicketViewer(ticket, req.user);
    const sessionKey = String(req.body?.sessionKey || ticket.liveCallLastSessionKey || '').trim();
    const sessionState = getSupportVideoSession(ticket._id);
    const mediaMode = normalizeLiveCallMediaMode(
        req.body?.mediaMode
        || sessionState?.mediaMode
        || ticket.liveCallLastMediaMode
        || ticket.liveCallRequestedMode
    );

    if (!sessionKey) {
        return next(new AppError('There is no active live support call to connect', 409));
    }

    if (
        isAdmin
        && ticket.liveCallStartedBy
        && String(ticket.liveCallStartedBy) !== String(req.user._id)
    ) {
        return next(new AppError('Another support agent already owns this live call', 409));
    }

    await markSupportTicketLiveCallConnected({
        ticketId: ticket._id,
        sessionKey,
        mediaMode,
    });
    markSupportVideoSessionConnected({
        ticketId: ticket._id,
        sessionKey,
    });

    await emitSupportRealtimeUpdate({
        ticketId: ticket._id,
    });

    res.json({
        success: true,
        data: isAdmin
            ? await loadAdminTicketView(ticket._id)
            : await loadUserTicketView(ticket._id),
        meta: {
            liveCallConnected: true,
            sessionKey,
        },
    });
});

// @desc    End an active LiveKit support session
// @route   POST /api/support/:id/video/end
// @access  Protected (ticket owner or assigned admin)
const endSupportLiveCallSession = asyncHandler(async (req, res, next) => {
    const ticket = await loadSupportTicketForSession(req.params.id);
    const { isAdmin, ticketOwnerId } = ensureSupportTicketViewer(ticket, req.user);
    const sessionState = getSupportVideoSession(ticket._id);
    const mediaMode = normalizeLiveCallMediaMode(
        req.body?.mediaMode
        || sessionState?.mediaMode
        || ticket.liveCallLastMediaMode
        || ticket.liveCallRequestedMode
    );
    const sessionKey = String(
        req.body?.sessionKey
        || sessionState?.sessionKey
        || ticket.liveCallLastSessionKey
        || ''
    ).trim();

    if (!sessionKey) {
        return next(new AppError('There is no active live support call to end', 409));
    }

    if (
        isAdmin
        && ticket.liveCallStartedBy
        && String(ticket.liveCallStartedBy) !== String(req.user._id)
    ) {
        return next(new AppError('Another support agent already owns this live call', 409));
    }

    const reason = String(req.body?.reason || '').trim().toLowerCase()
        || (String(ticket.liveCallLastStatus || '') === 'ringing' ? 'missed' : 'hangup');
    const clearedSession = clearSupportVideoSession({
        ticketId: ticket._id,
        sessionKey,
    });

    await deleteSupportRoom(sessionKey).catch((error) => {
        logger.warn('support.livekit_room_cleanup_failed', {
            ticketId: String(ticket._id),
            sessionKey,
            reason: error?.message || 'unknown',
        });
    });

    const supportCallUpdate = await markSupportTicketLiveCallEnded({
        ticketId: ticket._id,
        endedByRole: isAdmin ? 'admin' : 'user',
        sessionKey,
        reason,
        mediaMode,
    });

    await emitSupportRealtimeUpdate({
        ticketId: ticket._id,
        eventName: 'support:message:new',
        message: supportCallUpdate?.message || null,
    });

    const counterpartyUserId = clearedSession?.participants?.find((participantId) => participantId !== String(req.user._id))
        || (isAdmin
            ? ticketOwnerId
            : String(ticket.liveCallStartedBy || clearedSession?.adminUserId || ''));

    if (counterpartyUserId) {
        sendMessageToUser(counterpartyUserId, 'support:video:terminated', {
            supportTicketId: String(ticket._id),
            channelType: 'support_ticket',
            contextId: String(ticket._id),
            sessionKey,
            reason,
            mediaMode,
        });
    }

    res.json({
        success: true,
        data: isAdmin
            ? await loadAdminTicketView(ticket._id)
            : await loadUserTicketView(ticket._id),
        meta: {
            liveCallEnded: true,
            sessionKey,
            reason,
        },
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
    startSupportLiveCallSession,
    joinSupportLiveCallSession,
    connectSupportLiveCallSession,
    endSupportLiveCallSession,
    requestSupportLiveCall,
    addSystemLogToTicket,
    adminGetTickets,
    adminUpdateTicketStatus
};
