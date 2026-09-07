jest.mock('../models/SupportTicket', () => ({
  create: jest.fn(), findById: jest.fn(), findByIdAndUpdate: jest.fn(),
}));
jest.mock('../models/SupportMessage', () => ({ create: jest.fn() }));
jest.mock('../services/socketService', () => ({ sendMessageToAdmins: jest.fn(), sendMessageToUser: jest.fn() }));
jest.mock('../services/notificationService', () => ({ sendPersistentNotification: jest.fn() }));
jest.mock('../services/supportTicketViews', () => ({
  serializeTicketForUser: jest.fn((t) => ({ id: t._id })),
  serializeTicketForAdmin: jest.fn((t) => ({ id: t._id })),
  loadAdminTicketView: jest.fn(async () => ({ id: 't-1' })),
}));
jest.mock('../services/supportVideoService', () => ({ requestSupportTicketLiveCall: jest.fn() }));
jest.mock('../services/supportQueueSummaryService', () => ({ buildSupportQueueSummary: jest.fn() }));
jest.mock('../services/livekitService', () => ({
  buildSupportRoomName: jest.fn(), createSupportParticipantSession: jest.fn(),
  deleteSupportRoom: jest.fn(), ensureSupportRoom: jest.fn(),
}));

const SupportTicket = require('../models/SupportTicket');
const SupportMessage = require('../models/SupportMessage');
const { requestSupportTicketLiveCall } = require('../services/supportVideoService');
const {
  createSupportTicket,
  requestSupportLiveCall,
  sendSupportMessage,
} = require('../controllers/supportController');

const mockReqRes = (overrides = {}) => {
  const req = { body: {}, params: {}, query: {}, user: { _id: 'user-1', isAdmin: false }, ...overrides };
  const res = { json: jest.fn().mockReturnThis(), status: jest.fn().mockReturnThis() };
  const next = jest.fn();
  return { req, res, next };
};

describe('supportController.createSupportTicket', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates urgent tickets for moderation appeals', async () => {
    SupportTicket.create.mockResolvedValue({ _id: 't-1', toObject: () => ({ _id: 't-1' }) });
    SupportMessage.create.mockResolvedValue({});

    const { req, res, next } = mockReqRes({
      body: { subject: 'Ban appeal', category: 'moderation_appeal', message: 'Please review my case urgently.' },
    });
    await createSupportTicket(req, res, next);

    expect(SupportTicket.create).toHaveBeenCalledWith(expect.objectContaining({
      user: 'user-1', priority: 'urgent', lastActorRole: 'user', unreadByAdmin: 1,
    }));
    expect(SupportMessage.create).toHaveBeenCalledWith(expect.objectContaining({ ticket: 't-1', isAdmin: false }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });

  test('escalates suspended users and order issues', async () => {
    SupportTicket.create.mockResolvedValue({ _id: 't-2', toObject: () => ({ _id: 't-2' }) });
    SupportMessage.create.mockResolvedValue({});

    const suspended = mockReqRes({
      user: { _id: 'u-9', accountState: 'suspended' },
      body: { subject: 'Help', category: 'general_support', message: 'Need help with access.' },
    });
    await createSupportTicket(suspended.req, suspended.res, suspended.next);
    expect(SupportTicket.create).toHaveBeenCalledWith(expect.objectContaining({ priority: 'urgent' }));

    jest.clearAllMocks();
    SupportTicket.create.mockResolvedValue({ _id: 't-3', toObject: () => ({ _id: 't-3' }) });
    const orderIssue = mockReqRes({ body: { subject: 'Refund', category: 'order_issue', message: 'Where is my refund?' } });
    await createSupportTicket(orderIssue.req, orderIssue.res, orderIssue.next);
    expect(SupportTicket.create).toHaveBeenCalledWith(expect.objectContaining({ priority: 'high' }));
  });

  test('truncates the message preview to 150 chars', async () => {
    SupportTicket.create.mockResolvedValue({ _id: 't-4', toObject: () => ({ _id: 't-4' }) });
    SupportMessage.create.mockResolvedValue({});
    const longMessage = 'x'.repeat(500);
    const { req, res } = mockReqRes({ body: { subject: 'S', category: 'other', message: longMessage } });
    await createSupportTicket(req, res, jest.fn());
    expect(SupportTicket.create.mock.calls[0][0].lastMessagePreview).toHaveLength(150);
  });
});

describe('supportController.sendSupportMessage', () => {
  beforeEach(() => jest.clearAllMocks());

  const openTicket = { _id: 't-1', user: 'user-1', status: 'open', subject: 'Hi' };

  test('rejects foreign tickets with 403 (IDOR guard)', async () => {
    SupportTicket.findById.mockResolvedValue({ ...openTicket, user: 'user-2' });
    const { req, res, next } = mockReqRes({ params: { id: 't-1' }, body: { message: 'hi' } });
    await sendSupportMessage(req, res, next);
    expect(next.mock.calls[0][0].statusCode).toBe(403);
    expect(SupportMessage.create).not.toHaveBeenCalled();
  });

  test('rejects messages to closed tickets', async () => {
    SupportTicket.findById.mockResolvedValue({ ...openTicket, status: 'closed' });
    const { req, res, next } = mockReqRes({ params: { id: 't-1' }, body: { message: 'hi' } });
    await sendSupportMessage(req, res, next);
    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });

  test('returns 404 for missing tickets', async () => {
    SupportTicket.findById.mockResolvedValue(null);
    const { req, res, next } = mockReqRes({ params: { id: 't-x' }, body: { message: 'hi' } });
    await sendSupportMessage(req, res, next);
    expect(next.mock.calls[0][0].statusCode).toBe(404);
  });

  test('bumps unread counters atomically for user messages', async () => {
    SupportTicket.findById.mockResolvedValue(openTicket);
    SupportMessage.create.mockResolvedValue({ populate: jest.fn().mockResolvedValue({}) });
    SupportTicket.findByIdAndUpdate.mockResolvedValue({ ...openTicket, user: 'user-1' });

    const { req, res, next } = mockReqRes({ params: { id: 't-1' }, body: { message: 'Still waiting' } });
    await sendSupportMessage(req, res, next);

    expect(SupportTicket.findByIdAndUpdate).toHaveBeenCalledWith('t-1', expect.objectContaining({
      $inc: { unreadByAdmin: 1 },
    }), { new: true });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('supportController.requestSupportLiveCall', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 404 for missing tickets and 403 for foreign ones', async () => {
    SupportTicket.findById.mockResolvedValue(null);
    const missing = mockReqRes({ params: { id: 't-x' }, body: {} });
    await requestSupportLiveCall(missing.req, missing.res, missing.next);
    expect(missing.next.mock.calls[0][0].statusCode).toBe(404);

    SupportTicket.findById.mockResolvedValue({ _id: 't-1', user: 'user-2', status: 'open' });
    const foreign = mockReqRes({ params: { id: 't-1' }, body: {} });
    await requestSupportLiveCall(foreign.req, foreign.res, foreign.next);
    expect(foreign.next.mock.calls[0][0].statusCode).toBe(403);
  });

  test('refuses live calls on closed tickets', async () => {
    SupportTicket.findById.mockResolvedValue({ _id: 't-1', user: 'user-1', status: 'closed' });
    const { req, res, next } = mockReqRes({ params: { id: 't-1' }, body: {} });
    await requestSupportLiveCall(req, res, next);
    expect(next.mock.calls[0][0].statusCode).toBe(400);
    expect(requestSupportTicketLiveCall).not.toHaveBeenCalled();
  });
});
