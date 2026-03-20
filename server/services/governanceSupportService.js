const SupportTicket = require('../models/SupportTicket');
const SupportMessage = require('../models/SupportMessage');
const logger = require('../utils/logger');
const { sendMessageToAdmins, sendMessageToUser } = require('./socketService');
const { loadAdminTicketView, loadUserTicketView } = require('./supportTicketViews');

const clampText = (value, max = 2000) => String(value || '').trim().slice(0, max);

const GOVERNANCE_COPY = {
    warn: {
        subject: 'Account warning review',
        priority: 'high',
        requiresUserAction: false,
        summary: (reason) => [
            'Aura Trust & Safety issued a formal warning on your account.',
            `Reason: ${reason}`,
            'If you want to contest or clarify this warning, reply in this thread and the admin team will review the case.',
        ].join('\n'),
    },
    suspend: {
        subject: 'Account suspension review',
        priority: 'urgent',
        requiresUserAction: true,
        summary: (reason) => [
            'Aura Trust & Safety suspended your account.',
            `Reason: ${reason}`,
            'Reply in this thread to submit clarification or an appeal. Admin and support actions will remain attached to this case.',
        ].join('\n'),
    },
    delete: {
        subject: 'Account recovery review',
        priority: 'urgent',
        requiresUserAction: true,
        summary: (reason) => [
            'Aura Trust & Safety disabled your account.',
            `Reason: ${reason}`,
            'This internal recovery case was created so the admin team can document every follow-up. If recovery is approved, the result will be recorded against this case.',
        ].join('\n'),
    },
    dismiss_warning: {
        resolutionTitle: 'Warning dismissed by admin review.',
    },
    reactivate: {
        resolutionTitle: 'Account reactivated by admin review.',
    },
};

const RESOLUTION_SUBJECT_MAP = {
    dismiss_warning: GOVERNANCE_COPY.warn.subject,
    reactivate: GOVERNANCE_COPY.suspend.subject,
};

const emitTicketRealtime = async ({ ticketId, eventName = 'support:ticket:update', message = null }) => {
    const [adminTicket, userTicket] = await Promise.all([
        loadAdminTicketView(ticketId),
        loadUserTicketView(ticketId),
    ]);

    if (!adminTicket || !userTicket) return;

    const adminPayload = {
        ticketId: adminTicket._id,
        ticket: adminTicket,
        ...(message ? { message } : {}),
    };
    const userPayload = {
        ticketId: userTicket._id,
        ticket: userTicket,
        ...(message ? { message } : {}),
    };

    sendMessageToAdmins(eventName, adminPayload);
    sendMessageToUser(adminTicket.user?._id, eventName, userPayload);

    if (eventName !== 'support:ticket:update') {
        sendMessageToAdmins('support:ticket:update', {
            ticketId: adminTicket._id,
            ticket: adminTicket,
        });
        sendMessageToUser(adminTicket.user?._id, 'support:ticket:update', {
            ticketId: userTicket._id,
            ticket: userTicket,
        });
    }
};

const createGovernanceAppealTicket = async ({
    targetUser,
    actorUser,
    actionType,
    actionId,
    reason,
}) => {
    const copy = GOVERNANCE_COPY[actionType];
    if (!copy || !targetUser?._id || !actionId) return null;

    const text = clampText(copy.summary(reason), 1800);
    const ticket = await SupportTicket.create({
        user: targetUser._id,
        status: 'open',
        subject: copy.subject,
        category: 'moderation_appeal',
        priority: copy.priority,
        relatedActionId: String(actionId),
        userActionRequired: Boolean(copy.requiresUserAction),
        lastActorRole: 'system',
        unreadByUser: 1,
        unreadByAdmin: 0,
        lastMessagePreview: `[Governance] ${text.slice(0, 150)}`,
    });

    const message = await SupportMessage.create({
        ticket: ticket._id,
        sender: actorUser?._id || targetUser._id,
        text,
        isAdmin: true,
        isSystem: true,
    });

    ticket.lastMessageAt = message.sentAt || message.createdAt || new Date();
    await ticket.save();

    try {
        await emitTicketRealtime({
            ticketId: ticket._id,
            eventName: 'support:ticket:new',
            message,
        });
    } catch (error) {
        logger.warn('governance_support.emit_failed', {
            ticketId: String(ticket._id || ''),
            actionType,
            reason: error?.message || 'unknown',
        });
    }

    return ticket.toObject();
};

const resolveLatestGovernanceAppealTicket = async ({
    targetUser,
    actorUser,
    resolutionType,
    reason,
}) => {
    if (!targetUser?._id) return null;

    const filter = {
        user: targetUser._id,
        category: 'moderation_appeal',
        status: 'open',
    };
    const resolutionSubject = RESOLUTION_SUBJECT_MAP[resolutionType];
    if (resolutionSubject) {
        filter.subject = resolutionSubject;
    }

    const ticket = await SupportTicket.findOne(filter).sort({ lastMessageAt: -1 });

    if (!ticket) return null;

    const resolutionSummary = clampText(
        `${GOVERNANCE_COPY[resolutionType]?.resolutionTitle || 'Governance action resolved.'} ${reason || ''}`.trim(),
        800,
    );
    const systemText = clampText(
        [
            GOVERNANCE_COPY[resolutionType]?.resolutionTitle || 'Governance action resolved.',
            reason ? `Admin note: ${reason}` : '',
            'This moderation case is now marked resolved. You can still reference it for audit history.',
        ].filter(Boolean).join('\n'),
        1800,
    );

    ticket.status = 'resolved';
    ticket.userActionRequired = false;
    ticket.lastActorRole = 'system';
    ticket.resolutionSummary = resolutionSummary;
    ticket.resolvedAt = new Date();
    ticket.resolvedBy = actorUser?._id || null;
    ticket.unreadByUser = Number(ticket.unreadByUser || 0) + 1;

    const message = await SupportMessage.create({
        ticket: ticket._id,
        sender: actorUser?._id || targetUser._id,
        text: systemText,
        isAdmin: true,
        isSystem: true,
    });

    ticket.lastMessageAt = message.sentAt || message.createdAt || new Date();
    ticket.lastMessagePreview = `[Governance] ${systemText.slice(0, 150)}`;
    await ticket.save();

    try {
        await emitTicketRealtime({
            ticketId: ticket._id,
            eventName: 'support:message:new',
            message,
        });
    } catch (error) {
        logger.warn('governance_support.resolve_emit_failed', {
            ticketId: String(ticket._id || ''),
            resolutionType,
            reason: error?.message || 'unknown',
        });
    }

    return ticket.toObject();
};

module.exports = {
    createGovernanceAppealTicket,
    resolveLatestGovernanceAppealTicket,
};
