jest.mock('../models/UserNotification', () => ({
  find: jest.fn(),
  countDocuments: jest.fn(),
  updateMany: jest.fn(),
}));

const UserNotification = require('../models/UserNotification');
const {
  getNotifications,
  markAllAsRead,
  markAsRead,
} = require('../controllers/userNotificationController');

const mockReqRes = (overrides = {}) => {
  const req = { query: {}, body: {}, user: { _id: 'user-1' }, ...overrides };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  return { req, res, next };
};

describe('userNotificationController.getNotifications', () => {
  beforeEach(() => jest.clearAllMocks());

  const chainFor = (rows) => ({
    sort: jest.fn().mockReturnValue({
      skip: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(rows) }),
    }),
  });

  test('returns paginated notifications with totals', async () => {
    UserNotification.find.mockReturnValue(chainFor([{ _id: 'n-1' }, { _id: 'n-2' }]));
    UserNotification.countDocuments
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(3);

    const { req, res, next } = mockReqRes({ query: { page: '2', limit: '2' } });
    await getNotifications(req, res, next);

    expect(UserNotification.find).toHaveBeenCalledWith({ user: 'user-1' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true, count: 2, total: 12, unreadCount: 3, page: 2, totalPages: 6,
    }));
    expect(next).not.toHaveBeenCalled();
  });

  test('filters to unread notifications when requested (IDOR-safe scoping)', async () => {
    UserNotification.find.mockReturnValue(chainFor([]));
    UserNotification.countDocuments.mockResolvedValue(0);

    const { req, res } = mockReqRes({ query: { unreadOnly: 'true' } });
    await getNotifications(req, res, jest.fn());

    expect(UserNotification.find).toHaveBeenCalledWith({ user: 'user-1', isRead: false });
  });

  test('defaults to page 1 with limit 20', async () => {
    UserNotification.find.mockReturnValue(chainFor([]));
    UserNotification.countDocuments.mockResolvedValue(0);

    const { req, res } = mockReqRes();
    await getNotifications(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ page: 1, totalPages: 0 }));
  });

  test('forwards database failures to the error handler', async () => {
    const failure = new Error('db down');
    UserNotification.find.mockImplementation(() => { throw failure; });

    const { req, res, next } = mockReqRes();
    await getNotifications(req, res, next);
    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe('userNotificationController.markAsRead', () => {
  beforeEach(() => jest.clearAllMocks());

  test('marks only the caller-owned notifications as read', async () => {
    UserNotification.updateMany.mockResolvedValue({ modifiedCount: 2 });
    const { req, res, next } = mockReqRes({ body: { notificationIds: ['n-1', 'n-2'] } });
    await markAsRead(req, res, next);

    expect(UserNotification.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ['n-1', 'n-2'] }, user: 'user-1' },
      { $set: { isRead: true, readAt: expect.any(Date) } }
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Notifications marked as read' });
  });

  test('rejects missing or non-array id lists with 400', async () => {
    for (const body of [{}, { notificationIds: 'n-1' }, { notificationIds: null }]) {
      const { req, res, next } = mockReqRes({ body });
      await markAsRead(req, res, next);
      expect(next.mock.calls.at(-1)[0].statusCode).toBe(400);
    }
    expect(UserNotification.updateMany).not.toHaveBeenCalled();
  });
});

describe('userNotificationController.markAllAsRead', () => {
  test('marks every unread notification of the caller', async () => {
    UserNotification.updateMany.mockResolvedValue({ modifiedCount: 5 });
    const { req, res, next } = mockReqRes();
    await markAllAsRead(req, res, next);

    expect(UserNotification.updateMany).toHaveBeenCalledWith(
      { user: 'user-1', isRead: false },
      { $set: { isRead: true, readAt: expect.any(Date) } }
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, message: 'All notifications marked as read' });
  });
});
