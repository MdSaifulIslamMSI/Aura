const SupportTicket = require('../models/SupportTicket');

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
        liveCallRequested: Boolean(ticket.liveCallRequested),
        liveCallRequestedAt: ticket.liveCallRequestedAt || null,
        liveCallRequestedBy: ticket.liveCallRequestedBy || null,
        liveCallRequestedByRole: String(ticket.liveCallRequestedByRole || ''),
        liveCallRequestNote: String(ticket.liveCallRequestNote || ''),
        liveCallStartedAt: ticket.liveCallStartedAt || null,
        liveCallStartedBy: ticket.liveCallStartedBy || null,
        liveCallConnectedAt: ticket.liveCallConnectedAt || null,
        liveCallEndedAt: ticket.liveCallEndedAt || null,
        liveCallLastStatus: String(ticket.liveCallLastStatus || 'idle'),
        liveCallLastSessionKey: String(ticket.liveCallLastSessionKey || ''),
        liveCallLastContextLabel: String(ticket.liveCallLastContextLabel || ''),
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
        liveCallRequested: Boolean(ticket.liveCallRequested),
        liveCallRequestedAt: ticket.liveCallRequestedAt || null,
        liveCallRequestedByRole: String(ticket.liveCallRequestedByRole || ''),
        liveCallRequestNote: String(ticket.liveCallRequestNote || ''),
        liveCallStartedAt: ticket.liveCallStartedAt || null,
        liveCallConnectedAt: ticket.liveCallConnectedAt || null,
        liveCallEndedAt: ticket.liveCallEndedAt || null,
        liveCallLastStatus: String(ticket.liveCallLastStatus || 'idle'),
        liveCallLastSessionKey: String(ticket.liveCallLastSessionKey || ''),
        liveCallLastContextLabel: String(ticket.liveCallLastContextLabel || ''),
        createdAt: ticket.createdAt || null,
        updatedAt: ticket.updatedAt || null,
    };
};

const loadAdminTicketView = async (ticketId) => {
    const ticket = await SupportTicket.findById(ticketId)
        .populate('user', 'name email accountState')
        .lean();
    return serializeTicketForAdmin(ticket);
};

const loadUserTicketView = async (ticketId) => {
    const ticket = await SupportTicket.findById(ticketId).lean();
    return serializeTicketForUser(ticket);
};

module.exports = {
    loadAdminTicketView,
    loadUserTicketView,
    serializeTicketForAdmin,
    serializeTicketForUser,
};
