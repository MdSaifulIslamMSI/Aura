import { describe, expect, it } from 'vitest';
import { isDuoStepUpRequiredError, isTrustedDeviceChallengeError } from './authStepUp';

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

  it('detects Duo step-up required responses', () => {
    expect(isDuoStepUpRequiredError({
      status: 403,
      data: {
        code: 'DUO_STEP_UP_REQUIRED',
        feature: 'duo_step_up',
        message: 'Duo step-up verification is required for this action.',
      },
    })).toBe(true);

    expect(isDuoStepUpRequiredError({
      status: 403,
      message: 'Duo verification is required before this AWS action.',
    })).toBe(true);
  });

  it('does not classify unrelated forbidden responses as Duo step-up', () => {
    expect(isDuoStepUpRequiredError({
      status: 403,
      message: 'Admin access required',
    })).toBe(false);

    expect(isDuoStepUpRequiredError({
      status: 401,
      data: { code: 'DUO_STEP_UP_REQUIRED' },
    })).toBe(false);
  });
});
