jest.mock('../models/UserNotification', () => ({ create: jest.fn() }));
jest.mock('../services/socketService', () => ({ sendMessageToUser: jest.fn() }));

const UserNotification = require('../models/UserNotification');
const { sendMessageToUser } = require('../services/socketService');
const { sendPersistentNotification } = require('../services/notificationService');

describe('notificationService.sendPersistentNotification', () => {
  beforeEach(() => jest.clearAllMocks());

  test('persists and pushes notifications with safe urls', async () => {
    UserNotification.create.mockResolvedValue({ _id: 'n-1' });
    const result = await sendPersistentNotification('u-1', 'Order shipped', 'On its way', { actionUrl: '/orders/o-1' });
    expect(result).toEqual({ _id: 'n-1' });
    expect(UserNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      actionUrl: '/orders/o-1',
    }));
    expect(sendMessageToUser).toHaveBeenCalledWith('u-1', 'user:notification:new', { _id: 'n-1' });
  });

  test('strips unsafe action urls (open-redirect guard)', async () => {
    UserNotification.create.mockResolvedValue({ _id: 'n-2' });
    await sendPersistentNotification('u-1', 'Hi', 'There', { actionUrl: 'https://evil.example/phish' });
    const created = UserNotification.create.mock.calls[0][0];
    expect(created.actionUrl || '').not.toContain('evil.example');
    expect(created.actionLabel).toBe('');
  });

  test('logs and rethrows persistence failures', async () => {
    UserNotification.create.mockRejectedValue(new Error('db down'));
    await expect(sendPersistentNotification('u-1', 'Hi', 'There')).rejects.toThrow('db down');
  });
});
