const SupportTicket = require('../models/SupportTicket');
const SupportMessage = require('../models/SupportMessage');
const AppError = require('../utils/AppError');

const toIdString = (value) => String(value === undefined || value === null ? '' : value).trim();

const normalizeRole = (value) => {
    const normalized = toIdString(value).toLowerCase();
    return ['user', 'admin', 'system'].includes(normalized) ? normalized : 'system';
};

const normalizeLiveCallStatus = (value) => {
    const normalized = toIdString(value).toLowerCase();
    return ['idle', 'requested', 'ringing', 'connected', 'ended', 'declined', 'failed', 'missed'].includes(normalized)
        ? normalized
        : 'idle';
};

const normalizeLiveCallMediaMode = (value) => (toIdString(value).toLowerCase() === 'voice' ? 'voice' : 'video');
const getSupportCallModeLabel = (mediaMode = 'video') => (
    normalizeLiveCallMediaMode(mediaMode) === 'voice' ? 'voice call' : 'video call'
);

const buildSystemPreview = (text) => `[System] ${String(text || '').trim().slice(0, 120)}`;

const appendSupportSystemMessage = async ({
    ticket,
    text,
    role = 'system',
    unreadByUserIncrement = 0,
    unreadByAdminIncrement = 0,
}) => {
    const trimmedText = String(text || '').trim();
    if (!ticket?._id || !trimmedText) {
        return { ticket, message: null };
    }

    const message = await SupportMessage.create({
        ticket: ticket._id,
        sender: ticket.user,
        text: trimmedText,
        isAdmin: normalizeRole(role) !== 'user',
        isSystem: true,
    });

    ticket.lastMessageAt = new Date();
    ticket.lastMessagePreview = buildSystemPreview(trimmedText);
    ticket.lastActorRole = normalizeRole(role);
    ticket.unreadByUser = Math.max(0, Number(ticket.unreadByUser || 0) + Number(unreadByUserIncrement || 0));
    ticket.unreadByAdmin = Math.max(0, Number(ticket.unreadByAdmin || 0) + Number(unreadByAdminIncrement || 0));
    await ticket.save();

    return { ticket, message: message.toObject() };
};

const loadSupportTicketForVideo = async (ticketId) => {
    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) {
        throw new AppError('Support ticket not found', 404);
    }
    return ticket;
};

const requestSupportTicketLiveCall = async ({
    ticketId,
    requesterUserId,
    requesterRole = 'user',
    note = '',
    mediaMode = 'video',
}) => {
    const ticket = await loadSupportTicketForVideo(ticketId);

    if (String(ticket.status || '') === 'closed') {
        throw new AppError('Closed tickets cannot request live support calls', 400);
    }

    const normalizedRole = normalizeRole(requesterRole);
    const normalizedNote = String(note || '').trim().slice(0, 280);
    const normalizedMediaMode = normalizeLiveCallMediaMode(mediaMode);
    const modeLabel = getSupportCallModeLabel(normalizedMediaMode);
    const now = new Date();

    ticket.liveCallRequested = true;
    ticket.liveCallRequestedAt = now;
    ticket.liveCallRequestedBy = requesterUserId || null;
    ticket.liveCallRequestedByRole = normalizedRole;
    ticket.liveCallRequestNote = normalizedNote;
    ticket.liveCallRequestedMode = normalizedMediaMode;
    ticket.liveCallStartedAt = null;
    ticket.liveCallStartedBy = null;
    ticket.liveCallConnectedAt = null;
    ticket.liveCallEndedAt = null;
    ticket.liveCallLastStatus = 'requested';
    ticket.liveCallLastContextLabel = `${modeLabel.replace(/^./, (letter) => letter.toUpperCase())} requested`;
    ticket.liveCallLastSessionKey = '';
    ticket.liveCallLastMediaMode = normalizedMediaMode;

    const messageText = normalizedRole === 'admin'
        ? `Aura Support requested a ${modeLabel}.${normalizedNote ? ` Note: ${normalizedNote}` : ''}`
        : `Customer requested a ${modeLabel}.${normalizedNote ? ` Note: ${normalizedNote}` : ''}`;

    return appendSupportSystemMessage({
        ticket,
        text: messageText,
        role: normalizedRole,
        unreadByUserIncrement: normalizedRole === 'admin' ? 1 : 0,
        unreadByAdminIncrement: normalizedRole === 'user' ? 1 : 0,
    });
};

const markSupportTicketLiveCallStarted = async ({
    ticketId,
    startedByUserId,
    startedByRole = 'admin',
    sessionKey = '',
    contextLabel = 'Live support call started',
    mediaMode = 'video',
}) => {
    const ticket = await loadSupportTicketForVideo(ticketId);
    const now = new Date();
    const normalizedRole = normalizeRole(startedByRole);
    const normalizedMediaMode = normalizeLiveCallMediaMode(mediaMode);

    ticket.liveCallRequested = false;
    ticket.liveCallRequestNote = '';
    ticket.liveCallRequestedMode = normalizedMediaMode;
    ticket.liveCallStartedAt = now;
    ticket.liveCallStartedBy = startedByUserId || null;
    ticket.liveCallConnectedAt = null;
    ticket.liveCallEndedAt = null;
    ticket.liveCallLastStatus = 'ringing';
    ticket.liveCallLastSessionKey = toIdString(sessionKey);
    ticket.liveCallLastContextLabel = String(contextLabel || 'Live support call started').trim();
    ticket.liveCallLastMediaMode = normalizedMediaMode;

    return appendSupportSystemMessage({
        ticket,
        text: `${ticket.liveCallLastContextLabel}.`,
        role: normalizedRole,
        unreadByUserIncrement: normalizedRole === 'admin' ? 1 : 0,
        unreadByAdminIncrement: normalizedRole === 'user' ? 1 : 0,
    });
};

const markSupportTicketLiveCallConnected = async ({
    ticketId,
    sessionKey = '',
    mediaMode = 'video',
}) => {
    const ticket = await loadSupportTicketForVideo(ticketId);
    const normalizedMediaMode = normalizeLiveCallMediaMode(mediaMode);
    const modeLabel = getSupportCallModeLabel(normalizedMediaMode);

    ticket.liveCallRequested = false;
    ticket.liveCallConnectedAt = new Date();
    ticket.liveCallEndedAt = null;
    ticket.liveCallLastStatus = 'connected';
    ticket.liveCallLastSessionKey = toIdString(sessionKey) || ticket.liveCallLastSessionKey;
    ticket.liveCallLastContextLabel = `${modeLabel.replace(/^./, (letter) => letter.toUpperCase())} connected`;
    ticket.liveCallLastMediaMode = normalizedMediaMode;
    await ticket.save();

    return { ticket, message: null };
};

const humanizeEndReason = (reason) => {
    const normalized = toIdString(reason).toLowerCase();
    switch (normalized) {
        case 'declined':
            return { status: 'declined', text: 'Live support call was declined.' };
        case 'missed':
            return { status: 'missed', text: 'Live support call was missed.' };
        case 'failed':
            return { status: 'failed', text: 'Live support call failed before connecting.' };
        case 'participant_disconnect':
            return { status: 'ended', text: 'Live support call ended after a participant disconnected.' };
        default:
            return { status: 'ended', text: 'Live support call ended.' };
    }
};

const markSupportTicketLiveCallEnded = async ({
    ticketId,
    endedByRole = 'system',
    sessionKey = '',
    reason = 'hangup',
    mediaMode = '',
}) => {
    const ticket = await loadSupportTicketForVideo(ticketId);
    const normalizedRole = normalizeRole(endedByRole);
    const { status, text } = humanizeEndReason(reason);
    const normalizedMediaMode = mediaMode
        ? normalizeLiveCallMediaMode(mediaMode)
        : normalizeLiveCallMediaMode(ticket.liveCallLastMediaMode || ticket.liveCallRequestedMode || 'video');

    ticket.liveCallRequested = false;
    ticket.liveCallRequestNote = '';
    ticket.liveCallEndedAt = new Date();
    ticket.liveCallLastStatus = normalizeLiveCallStatus(status);
    ticket.liveCallLastSessionKey = toIdString(sessionKey) || ticket.liveCallLastSessionKey;
    ticket.liveCallLastContextLabel = text.replace(/\.$/, '');
    ticket.liveCallLastMediaMode = normalizedMediaMode;

    return appendSupportSystemMessage({
        ticket,
        text,
        role: normalizedRole,
        unreadByUserIncrement: normalizedRole === 'admin' ? 1 : 0,
        unreadByAdminIncrement: normalizedRole === 'user' ? 1 : 0,
    });
};

module.exports = {
    appendSupportSystemMessage,
    loadSupportTicketForVideo,
    markSupportTicketLiveCallConnected,
    markSupportTicketLiveCallEnded,
    markSupportTicketLiveCallStarted,
    requestSupportTicketLiveCall,
};
