import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/apiBase', () => ({ apiFetch: vi.fn() }));
vi.mock('../services/api/apiUtils', () => ({ getAuthHeader: vi.fn(async () => ({})) }));
vi.mock('../services/csrfTokenManager', () => ({
  addCsrfTokenToHeaders: vi.fn((headers) => ({ ...headers, 'X-CSRF-Token': 'csrf-1' })),
  ensureCsrfToken: vi.fn(async () => 'csrf-1'),
}));
vi.mock('../services/deviceTrustClient', () => ({
  getTrustedDeviceHeaders: vi.fn(() => ({ 'X-Device-Id': 'device-1' })),
  signTrustedDeviceChallenge: vi.fn(),
}));

import { apiFetch } from '../services/apiBase';
import { getAuthHeader } from '../services/api/apiUtils';
import { ensureCsrfToken } from '../services/csrfTokenManager';
import { signTrustedDeviceChallenge } from '../services/deviceTrustClient';
import {
  attachAlienProof,
  isAlienOtpClientEnabled,
  requestAlienChallenge,
  signAlienChallengeWithPasskey,
} from './alienOtpClient';

describe('isAlienOtpClientEnabled', () => {
  it('is disabled by default', () => {
    vi.stubEnv('VITE_ALIEN_OTP_ENABLED', '');
    expect(isAlienOtpClientEnabled()).toBe(false);
  });

  it.each(['1', 'true', 'yes', 'on', ' TRUE '])('treats %s as enabled', (value) => {
    vi.stubEnv('VITE_ALIEN_OTP_ENABLED', value);
    expect(isAlienOtpClientEnabled()).toBe(true);
  });

  it.each(['0', 'false', 'no', 'off'])('treats %s as disabled', (value) => {
    vi.stubEnv('VITE_ALIEN_OTP_ENABLED', value);
    expect(isAlienOtpClientEnabled()).toBe(false);
  });
});

describe('requestAlienChallenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_ALIEN_OTP_ENABLED', 'true');
  });

  it('throws when action is missing', async () => {
    await expect(requestAlienChallenge({})).rejects.toThrow('ALIEN OTP action is required.');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('posts a trimmed challenge request with csrf headers', async () => {
    apiFetch.mockResolvedValue({ data: { challengeId: 'ch-1' } });
    const data = await requestAlienChallenge({ action: '  checkout  ', resourceId: ' order-9 ' });

    expect(data).toEqual({ challengeId: 'ch-1' });
    expect(apiFetch).toHaveBeenCalledWith('/security/alien-otp/challenge', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-1' }),
    }));
    const body = JSON.parse(apiFetch.mock.calls[0][1].body);
    expect(body).toEqual({ action: 'checkout', resourceId: 'order-9' });
  });

  it('skips csrf when a bearer token is present', async () => {
    getAuthHeader.mockResolvedValueOnce({ Authorization: 'Bearer abc' });
    apiFetch.mockResolvedValue({ data: {} });
    await requestAlienChallenge({ action: 'login' });
    expect(ensureCsrfToken).not.toHaveBeenCalled();
  });
});

describe('signAlienChallengeWithPasskey', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when the challenge is incomplete', async () => {
    await expect(signAlienChallengeWithPasskey({})).rejects.toThrow('ALIEN OTP challenge is incomplete.');
  });

  it('falls back to MFA step-up when webauthn options are missing', async () => {
    const failure = await signAlienChallengeWithPasskey({
      challenge: { challengeId: 'c', publicChallenge: 'p' },
    }).catch((error) => error);
    expect(failure.message).toContain('passkey proof is unavailable');
    expect(failure.fallback).toBe('existing_mfa_step_up');
  });

  it('returns the webauthn proof credential', async () => {
    signTrustedDeviceChallenge.mockResolvedValue({
      method: 'webauthn', deviceId: 'd1', deviceLabel: 'Phone', credential: { id: 'cred' },
    });
    const proof = await signAlienChallengeWithPasskey({
      challenge: { challengeId: 'c', publicChallenge: 'p', webauthnOptions: {} },
    });
    expect(proof).toEqual({ method: 'webauthn', deviceId: 'd1', deviceLabel: 'Phone', credential: { id: 'cred' } });
  });

  it('throws when the proof is not a webauthn assertion', async () => {
    signTrustedDeviceChallenge.mockResolvedValue({ method: 'otp', credential: null });
    await expect(signAlienChallengeWithPasskey({
      challenge: { challengeId: 'c', publicChallenge: 'p', webauthnOptions: {} },
    })).rejects.toThrow('requires a passkey assertion');
  });
});

describe('attachAlienProof', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the request untouched when disabled', async () => {
    vi.stubEnv('VITE_ALIEN_OTP_ENABLED', 'false');
    const request = { url: '/api/x' };
    await expect(attachAlienProof({ request, action: 'x' })).resolves.toBe(request);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('attaches challenge, action, resource and proof headers', async () => {
    vi.stubEnv('VITE_ALIEN_OTP_ENABLED', 'true');
    apiFetch.mockResolvedValue({ data: { challengeId: 'ch-7', publicChallenge: 'pub', webauthnOptions: {} } });
    signTrustedDeviceChallenge.mockResolvedValue({
      method: 'webauthn', deviceId: '', deviceLabel: '', credential: { id: 'cred-7' },
    });

    const result = await attachAlienProof({ request: { headers: {} }, action: ' pay ', resourceId: ' r1 ' });

    expect(result.headers.get('X-Alien-OTP-Challenge-Id')).toBe('ch-7');
    expect(result.headers.get('X-Alien-OTP-Action')).toBe('pay');
    expect(result.headers.get('X-Alien-OTP-Resource')).toBe('r1');
    expect(result.headers.get('X-Alien-OTP-Proof')).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.headers.get('X-Device-Id')).toBe('device-1');
    expect(result.alienOtpChallenge.challengeId).toBe('ch-7');
  });
});
