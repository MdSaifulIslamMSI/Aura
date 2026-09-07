import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../apiBase', () => ({ apiFetch: vi.fn() }));
vi.mock('./apiUtils', () => ({
  getAuthHeader: vi.fn(async () => ({ Authorization: 'Bearer t' })),
  createIdempotencyKey: vi.fn((scope) => `key-${scope}-1`),
}));

import { apiFetch } from '../apiBase';
import { paymentApi } from './paymentApi';

describe('paymentApi client contract', () => {
  beforeEach(() => vi.clearAllMocks());

  it('attaches auth headers and unwraps data on reads', async () => {
    apiFetch.mockResolvedValue({ data: { id: 'pi_1' } });
    await expect(paymentApi.getIntent('pi_1')).resolves.toEqual({ id: 'pi_1' });
    expect(apiFetch).toHaveBeenCalledWith('/payments/intents/pi_1', {
      headers: { Authorization: 'Bearer t' },
    });
  });

  it('generates an idempotency key when the caller omits one', async () => {
    apiFetch.mockResolvedValue({ data: {} });
    await paymentApi.createIntent({ amount: 500 });
    const headers = apiFetch.mock.calls[0][1].headers;
    expect(headers['Idempotency-Key']).toBe('key-intent-1');
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toMatchObject({ amount: 500 });
  });

  it('prefers caller-supplied idempotency keys (double-charge guard)', async () => {
    apiFetch.mockResolvedValue({ data: {} });
    await paymentApi.confirmIntent('pi_1', { idempotencyKey: 'caller-9' });
    expect(apiFetch.mock.calls[0][1].headers['Idempotency-Key']).toBe('caller-9');
  });

  it('scopes refund idempotency per intent', async () => {
    apiFetch.mockResolvedValue({ data: {} });
    await paymentApi.createRefund('pi_7', { amount: 100 });
    expect(apiFetch.mock.calls[0][0]).toBe('/payments/intents/pi_7/refunds');
    expect(apiFetch.mock.calls[0][1].headers['Idempotency-Key']).toBe('key-refund-1');
  });

  it('updates refund ledger references via PATCH with composite ids', async () => {
    apiFetch.mockResolvedValue({ data: { ok: true } });
    await paymentApi.updateRefundLedgerReference('o-1', 'r-2', { reference: 'UTR123' });
    expect(apiFetch.mock.calls[0][0]).toBe('/admin/payments/refunds/ledger/o-1/r-2/reference');
    expect(apiFetch.mock.calls[0][1].method).toBe('PATCH');
  });

  it('forwards admin list params untouched', async () => {
    apiFetch.mockResolvedValue({ data: [] });
    await paymentApi.getAdminPayments({ page: 2, status: 'requires_capture' });
    expect(apiFetch.mock.calls[0][1].params).toEqual({ page: 2, status: 'requires_capture' });
  });

  it('propagates apiFetch failures without swallowing', async () => {
    apiFetch.mockRejectedValue(new Error('network down'));
    await expect(paymentApi.getMethods()).rejects.toThrow('network down');
  });

  it('deletes methods with DELETE and no body', async () => {
    apiFetch.mockResolvedValue({ data: {} });
    await paymentApi.deleteMethod('pm_1');
    expect(apiFetch.mock.calls[0]).toEqual(['/payments/methods/pm_1', expect.objectContaining({ method: 'DELETE' })]);
  });
});
