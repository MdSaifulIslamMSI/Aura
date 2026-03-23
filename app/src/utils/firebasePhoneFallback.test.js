import { describe, expect, it } from 'vitest';
import { resolveFirebasePhoneFallback } from './firebasePhoneFallback';

describe('resolveFirebasePhoneFallback', () => {
  it('falls back and disables Firebase phone OTP for billing errors', () => {
    expect(resolveFirebasePhoneFallback({
      code: 'auth/billing-not-enabled',
      message: 'Firebase: Error (auth/billing-not-enabled).',
    })).toMatchObject({
      code: 'auth/billing-not-enabled',
      disableFirebasePhoneOtp: true,
      success: {
        title: 'Backup OTP Route Active',
      },
    });
  });

  it('falls back for reCAPTCHA failures without disabling the session path', () => {
    expect(resolveFirebasePhoneFallback({
      code: 'auth/captcha-check-failed',
      message: 'Firebase reCAPTCHA challenge failed.',
    })).toMatchObject({
      code: 'auth/captcha-check-failed',
      disableFirebasePhoneOtp: false,
      success: {
        title: 'Backup OTP Ready',
      },
    });
  });

  it('returns null for verification code mistakes that should stay on Firebase flow', () => {
    expect(resolveFirebasePhoneFallback({
      code: 'auth/invalid-verification-code',
      message: 'The SMS verification code used to create the phone auth credential is invalid.',
    })).toBeNull();
  });
});
