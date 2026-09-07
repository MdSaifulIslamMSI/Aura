const User = require('../models/User');
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

describe('userNotificationController integration', () => {
  let user;

  beforeEach(async () => {
    user = await User.create({ name: 'Notify', email: `notify-${Date.now()}@example.com` });
    await UserNotification.create([
      { user: user._id, title: 'Order shipped', message: 'On its way', isRead: false },
      { user: user._id, title: 'Deal', message: 'Price drop', isRead: true },
    ]);
  });

  test('lists with totals and unread counts', async () => {
    const { req, res, next } = mockReqRes({ user: { _id: user._id } });
    await getNotifications(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true, count: 2, total: 2, unreadCount: 1, page: 1,
    }));
  });

  test('filters unread and paginates', async () => {
    const { req, res } = mockReqRes({ user: { _id: user._id }, query: { unreadOnly: 'true', limit: '1' } });
    await getNotifications(req, res, jest.fn());
    const body = res.json.mock.calls[0][0];
    expect(body.count).toBe(1);
    expect(body.total).toBe(1);
    expect(body.totalPages).toBe(1);
  });

  test('marks selected and all as read', async () => {
    const one = await UserNotification.findOne({ user: user._id, isRead: false });
    const single = mockReqRes({ user: { _id: user._id }, body: { notificationIds: [one._id] } });
    await markAsRead(single.req, single.res, single.next);
    await expect(UserNotification.countDocuments({ user: user._id, isRead: false })).resolves.toBe(0);

    await UserNotification.create({ user: user._id, title: 'New', message: 'Ping', isRead: false });
    const all = mockReqRes({ user: { _id: user._id } });
    await markAllAsRead(all.req, all.res, all.next);
    await expect(UserNotification.countDocuments({ user: user._id, isRead: false })).resolves.toBe(0);
  });

  test('isolates tenants from each other', async () => {
    const other = await User.create({ name: 'Other', email: `other-${Date.now()}@example.com` });
    const { req, res } = mockReqRes({ user: { _id: other._id } });
    await getNotifications(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ total: 0, unreadCount: 0 }));
  });
});
