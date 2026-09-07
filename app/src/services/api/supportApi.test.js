import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../apiBase', () => ({ apiFetch: vi.fn() }));
vi.mock('./apiUtils', () => ({ getAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer t' })) }));

import { apiFetch } from '../apiBase';
import { supportApi } from './supportApi';

describe('supportApi tickets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates tickets with a JSON body and auth headers', async () => {
    apiFetch.mockResolvedValue({ data: { id: 't-1' } });
    await supportApi.createTicket({ subject: 'Refund', orderId: 'o-1' });
    expect(apiFetch).toHaveBeenCalledWith('/support', expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer t' },
    }));
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toMatchObject({ subject: 'Refund' });
  });

  it('forwards list params and unwraps data', async () => {
    apiFetch.mockResolvedValue({ data: [{ id: 't-1' }] });
    await expect(supportApi.getTickets({ status: 'open' })).resolves.toEqual([{ id: 't-1' }]);
    expect(apiFetch.mock.calls[0][1].params).toEqual({ status: 'open' });
  });

  it('wraps plain messages in an object envelope', async () => {
    apiFetch.mockResolvedValue({ data: {} });
    await supportApi.sendMessage('t-1', 'Where is my order?');
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ message: 'Where is my order?' });
  });
});

describe('supportApi video sessions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes through full payload objects for video requests', async () => {
    apiFetch.mockResolvedValue({ data: {} });
    await supportApi.requestVideoCall('t-1', { mediaMode: 'video', note: 'Screen share' });
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ mediaMode: 'video', note: 'Screen share' });
  });

  it('shapes note strings and media modes into a body', async () => {
    apiFetch.mockResolvedValue({ data: {} });
    await supportApi.requestVideoCall('t-1', 'Need help', 'audio');
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ note: 'Need help', mediaMode: 'audio' });
  });

  it('sends an empty body when neither note nor mode is given', async () => {
    apiFetch.mockResolvedValue({ data: {} });
    await supportApi.requestVideoCall('t-1');
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({});
  });

  it('drives the session lifecycle endpoints', async () => {
    apiFetch.mockResolvedValue({ data: {} });
    await supportApi.startVideoSession('t-1', { sdp: 'offer' });
    await supportApi.joinVideoSession('t-1', {});
    await supportApi.markVideoSessionConnected('t-1', {});
    await supportApi.endVideoSession('t-1', { reason: 'done' });
    const paths = apiFetch.mock.calls.map(([path]) => path);
    expect(paths).toEqual([
      '/support/t-1/video/start',
      '/support/t-1/video/join',
      '/support/t-1/video/connected',
      '/support/t-1/video/end',
    ]);
  });
});

describe('supportApi admin endpoints', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts status strings and wraps them', async () => {
    apiFetch.mockResolvedValue({ data: {} });
    await supportApi.adminUpdateStatus('t-1', 'resolved');
    expect(apiFetch.mock.calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ status: 'resolved' });
  });

  it('passes status objects through untouched', async () => {
    apiFetch.mockResolvedValue({ data: {} });
    await supportApi.adminUpdateStatus('t-1', { status: 'pending', assignee: 'a-1' });
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ status: 'pending', assignee: 'a-1' });
  });

  it('propagates failures', async () => {
    apiFetch.mockRejectedValue(new Error('forbidden'));
    await expect(supportApi.adminGetTickets({})).rejects.toThrow('forbidden');
  });
});
