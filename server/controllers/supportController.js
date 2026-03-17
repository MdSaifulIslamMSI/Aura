const asyncHandler = require('express-async-handler');
const SupportTicket = require('../models/SupportTicket');
const SupportMessage = require('../models/SupportMessage');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { sendMessageToUser } = require('../services/socketService'); // Push via websockets

const getPagination = (req) => {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    return { page, limit, skip };
};

// @desc    Create a new support ticket
// @route   POST /api/support
// @access  Protected (Active + Suspended)
const createSupportTicket = asyncHandler(async (req, res, next) => {
    const { subject, category, message, relatedActionId } = req.body;

    const ticket = await SupportTicket.create({
        user: req.user._id,
        subject,
        category,
        relatedActionId: relatedActionId || '',
        lastMessagePreview: message.substring(0, 150),
        unreadByAdmin: 1, // Start with 1 unread for admin
    });

    await SupportMessage.create({
        ticket: ticket._id,
        sender: req.user._id,
        text: message,
        isAdmin: false,
        isSystem: false,
    });

    // Notify online admins
    // Note: To broadcast to admins, we would have a 'admin:ticket:new' room or event.
    // For now, it will polling or simple user pushes.

    res.status(201).json({
        success: true,
        data: ticket,
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
        data: tickets,
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
    if (isAdmin) {
        ticket.unreadByUser += 1;
        if (ticket.status === 'resolved') {
            ticket.status = 'open'; // Reopen on new message
        }
    } else {
        ticket.unreadByAdmin += 1;
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
    }

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
    ticket.unreadByUser += 1;
    await ticket.save();

    try {
        sendMessageToUser(ticket.user, 'support:message:new', {
            ticketId: ticket._id,
            message: message,
        });
    } catch(e) {}

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
        data: tickets,
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

    ticket.status = req.body.status;
    await ticket.save();

    await addSystemLogToTicket(ticket._id, `Status updated to ${req.body.status}`);

    res.json({
        success: true,
        data: ticket,
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
