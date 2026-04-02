const mongoose = require('mongoose');
const SupportTicket = require('../models/SupportTicket');
const SupportMessage = require('../models/SupportMessage');
const {
    markSupportTicketLiveCallConnected,
    markSupportTicketLiveCallEnded,
    markSupportTicketLiveCallStarted,
    requestSupportTicketLiveCall,
} = require('../services/supportVideoService');

describe('supportVideoService', () => {
    const userId = new mongoose.Types.ObjectId();
    const adminId = new mongoose.Types.ObjectId();

    const createTicket = () => SupportTicket.create({
        user: userId,
        subject: 'Need order help',
        category: 'order_issue',
        priority: 'high',
        lastMessagePreview: 'Initial issue',
    });

    test('persists live support call request state and system message', async () => {
        const ticket = await createTicket();

        const result = await requestSupportTicketLiveCall({
            ticketId: ticket._id,
            requesterUserId: userId,
            requesterRole: 'user',
            note: 'Need a real-time walkthrough',
        });

        expect(result.ticket.liveCallRequested).toBe(true);
        expect(result.ticket.liveCallLastStatus).toBe('requested');
        expect(result.ticket.liveCallRequestNote).toContain('walkthrough');

        const messages = await SupportMessage.find({ ticket: ticket._id }).lean();
        expect(messages).toHaveLength(1);
        expect(messages[0].isSystem).toBe(true);
        expect(messages[0].text).toContain('Customer requested a video call');
    });

    test('tracks support call lifecycle through started, connected, and ended states', async () => {
        const ticket = await createTicket();
        const sessionKey = 'support_ticket:abc:one:two';

        await markSupportTicketLiveCallStarted({
            ticketId: ticket._id,
            startedByUserId: adminId,
            startedByRole: 'admin',
            sessionKey,
            contextLabel: 'Aura Support started a live call for "Need order help"',
        });

        await markSupportTicketLiveCallConnected({
            ticketId: ticket._id,
            sessionKey,
        });

        const connectedTicket = await SupportTicket.findById(ticket._id).lean();
        expect(connectedTicket.liveCallLastStatus).toBe('connected');
        expect(String(connectedTicket.liveCallLastSessionKey)).toBe(sessionKey);

        const endResult = await markSupportTicketLiveCallEnded({
            ticketId: ticket._id,
            endedByRole: 'admin',
            sessionKey,
            reason: 'hangup',
        });

        expect(endResult.ticket.liveCallLastStatus).toBe('ended');
        expect(endResult.message.text).toContain('Live support call ended');
    });
});
