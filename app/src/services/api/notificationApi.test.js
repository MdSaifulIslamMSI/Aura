import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../apiBase', () => ({ apiFetch: vi.fn() }));
vi.mock('./apiUtils', () => ({ getAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer t' })) }));

import { apiFetch } from '../apiBase';
import { notificationApi } from './notificationApi';

describe('notificationApi client contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards list params with auth headers and unwraps data', async () => {
    apiFetch.mockResolvedValue({ data: [{ id: 'n-1' }] });
    await expect(notificationApi.getNotifications({ unreadOnly: 'true', page: '1' }))
      .resolves.toEqual([{ id: 'n-1' }]);
    expect(apiFetch).toHaveBeenCalledWith('/notifications', {
      headers: { Authorization: 'Bearer t' },
      params: { unreadOnly: 'true', page: '1' },
    });
  });

  it('serializes id arrays for bulk read', async () => {
    apiFetch.mockResolvedValue({ data: {} });
    await notificationApi.markAsRead(['n-1', 'n-2']);
    expect(apiFetch.mock.calls[0][1].method).toBe('PUT');
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ notificationIds: ['n-1', 'n-2'] });
  });

  it('marks all as read without a body', async () => {
    apiFetch.mockResolvedValue({ data: {} });
    await notificationApi.markAllAsRead();
    const [, options] = apiFetch.mock.calls[0];
    expect(apiFetch.mock.calls[0][0]).toBe('/notifications/read-all');
    expect(options.method).toBe('PUT');
    expect(options.body).toBeUndefined();
  });

  it('propagates failures', async () => {
    apiFetch.mockRejectedValue(new Error('unauthorized'));
    await expect(notificationApi.getNotifications({})).rejects.toThrow('unauthorized');
  });
});
