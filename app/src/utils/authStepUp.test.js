import { describe, expect, it } from 'vitest';
import { isTrustedDeviceChallengeError } from './authStepUp';

describe('auth step-up errors', () => {
  it('detects trusted-device challenge responses', () => {
    expect(isTrustedDeviceChallengeError({
      status: 403,
      message: 'Trusted device verification required for this account',
    })).toBe(true);

    expect(isTrustedDeviceChallengeError({
      status: 403,
      data: { message: 'Fresh trusted device verification is required.' },
    })).toBe(true);
  });

  it('does not classify unrelated forbidden responses as trusted-device challenges', () => {
    expect(isTrustedDeviceChallengeError({
      status: 403,
      message: 'Admin access required',
    })).toBe(false);

    expect(isTrustedDeviceChallengeError({
      status: 401,
      message: 'Trusted device verification required for this account',
    })).toBe(false);
  });
});

