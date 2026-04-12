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

  it('disables Firebase phone OTP when the Firebase auth iframe is blocked by CSP', () => {
    expect(resolveFirebasePhoneFallback({
      code: 'auth/internal-error',
      message: "Framing 'https://billy-b674c.firebaseapp.com/' violates the following Content Security Policy directive: \"frame-src 'self' https://checkout.razorpay.com\".",
    })).toMatchObject({
      disableFirebasePhoneOtp: true,
      success: {
        title: 'Backup OTP Route Active',
      },
    });
  });

  it('disables Firebase phone OTP when reCAPTCHA enterprise bootstrap is unauthorized', () => {
    expect(resolveFirebasePhoneFallback({
      code: 'auth/internal-error',
      message: 'Failed to initialize reCAPTCHA Enterprise config. POST https://www.google.com/recaptcha/api2/pat?k=test 401 (Unauthorized).',
    })).toMatchObject({
      disableFirebasePhoneOtp: true,
      success: {
        title: 'Backup OTP Route Active',
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
