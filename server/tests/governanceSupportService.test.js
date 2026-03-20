jest.mock('../models/SupportTicket', () => ({
    create: jest.fn(),
    findOne: jest.fn(),
}));

jest.mock('../models/SupportMessage', () => ({
    create: jest.fn(),
}));

jest.mock('../services/socketService', () => ({
    sendMessageToAdmins: jest.fn(),
    sendMessageToUser: jest.fn(),
}));

jest.mock('../services/supportTicketViews', () => ({
    loadAdminTicketView: jest.fn(),
    loadUserTicketView: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
    warn: jest.fn(),
}));

const SupportTicket = require('../models/SupportTicket');
const SupportMessage = require('../models/SupportMessage');
const { sendMessageToAdmins, sendMessageToUser } = require('../services/socketService');
const { loadAdminTicketView, loadUserTicketView } = require('../services/supportTicketViews');
const {
    createGovernanceAppealTicket,
    resolveLatestGovernanceAppealTicket,
} = require('../services/governanceSupportService');

const makeTicketDoc = (overrides = {}) => ({
    _id: 'ticket_1',
    user: { _id: 'user_1' },
    lastMessageAt: null,
    lastMessagePreview: '',
    userActionRequired: true,
    status: 'open',
    save: jest.fn().mockResolvedValue(undefined),
    toObject() {
        return {
            _id: this._id,
            user: this.user,
            lastMessageAt: this.lastMessageAt,
            lastMessagePreview: this.lastMessagePreview,
            userActionRequired: this.userActionRequired,
            status: this.status,
        };
    },
    ...overrides,
});

describe('governanceSupportService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        loadAdminTicketView.mockResolvedValue({ _id: 'ticket_1', user: { _id: 'user_1' } });
        loadUserTicketView.mockResolvedValue({ _id: 'ticket_1', user: { _id: 'user_1' } });
    });

    test('createGovernanceAppealTicket creates and emits a moderation appeal ticket', async () => {
        const ticketDoc = makeTicketDoc();
        SupportTicket.create.mockResolvedValue(ticketDoc);
        SupportMessage.create.mockResolvedValue({ _id: 'message_1', sentAt: new Date('2026-03-20T12:00:00.000Z') });

        const result = await createGovernanceAppealTicket({
            targetUser: { _id: 'user_1' },
            actorUser: { _id: 'admin_1' },
            actionType: 'suspend',
            actionId: 'ugl_1',
            reason: 'Repeated fraud attempts',
        });

        expect(SupportTicket.create).toHaveBeenCalledWith(expect.objectContaining({
            user: 'user_1',
            category: 'moderation_appeal',
            relatedActionId: 'ugl_1',
        }));
        expect(SupportMessage.create).toHaveBeenCalledWith(expect.objectContaining({
            ticket: 'ticket_1',
            isAdmin: true,
            isSystem: true,
        }));
        expect(sendMessageToAdmins).toHaveBeenCalled();
        expect(sendMessageToUser).toHaveBeenCalled();
        expect(result).toMatchObject({ _id: 'ticket_1' });
    });

    test('resolveLatestGovernanceAppealTicket resolves the matching open moderation case', async () => {
        const ticketDoc = makeTicketDoc({
            subject: 'Account suspension review',
            resolvedAt: null,
            resolvedBy: null,
        });
        SupportTicket.findOne.mockReturnValue({
            sort: jest.fn().mockResolvedValue(ticketDoc),
        });
        SupportMessage.create.mockResolvedValue({ _id: 'message_2', sentAt: new Date('2026-03-20T12:05:00.000Z') });

        const result = await resolveLatestGovernanceAppealTicket({
            targetUser: { _id: 'user_1' },
            actorUser: { _id: 'admin_1' },
            resolutionType: 'reactivate',
            reason: 'Appeal approved',
        });

        expect(SupportTicket.findOne).toHaveBeenCalledWith(expect.objectContaining({
            user: 'user_1',
            category: 'moderation_appeal',
            status: 'open',
            subject: 'Account suspension review',
        }));
        expect(ticketDoc.status).toBe('resolved');
        expect(ticketDoc.userActionRequired).toBe(false);
        expect(ticketDoc.save).toHaveBeenCalled();
        expect(result).toMatchObject({ _id: 'ticket_1', status: 'resolved' });
    });
});
