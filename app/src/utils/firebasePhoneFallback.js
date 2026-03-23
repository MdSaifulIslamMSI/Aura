const FALLBACK_CODES = new Set([
  'auth/app-not-authorized',
  'auth/billing-not-enabled',
  'auth/captcha-check-failed',
  'auth/configuration-unavailable',
  'auth/invalid-api-key',
  'auth/invalid-app-credential',
  'auth/missing-app-credential',
  'auth/network-request-failed',
  'auth/operation-not-allowed',
  'auth/quota-exceeded',
  'auth/too-many-requests',
]);

const SESSION_DISABLE_CODES = new Set([
  'auth/app-not-authorized',
  'auth/billing-not-enabled',
  'auth/configuration-unavailable',
  'auth/invalid-api-key',
  'auth/operation-not-allowed',
]);

const extractErrorCode = (error) => String(error?.code || '').trim().toLowerCase();

const extractErrorMessage = (error) => String(
  error?.message
  || error?.error
  || error?.response?.data?.message
  || ''
).trim().toLowerCase();

export const resolveFirebasePhoneFallback = (error) => {
  const code = extractErrorCode(error);
  const message = extractErrorMessage(error);

  const mentionsRecaptcha = message.includes('recaptcha');
  const mentionsBilling = message.includes('billing-not-enabled')
    || message.includes('billing not enabled')
    || message.includes('blaze plan');
  const mentionsDisabledProvider = message.includes('operation-not-allowed')
    || message.includes('provider is disabled')
    || message.includes('phone auth is not enabled');

  const shouldFallback = FALLBACK_CODES.has(code)
    || mentionsRecaptcha
    || mentionsBilling
    || mentionsDisabledProvider;

  if (!shouldFallback) {
    return null;
  }

  const disableFirebasePhoneOtp = SESSION_DISABLE_CODES.has(code)
    || mentionsBilling
    || mentionsDisabledProvider;

  return {
    code,
    message,
    disableFirebasePhoneOtp,
    success: {
      title: disableFirebasePhoneOtp ? 'Backup OTP Route Active' : 'Backup OTP Ready',
      detail: disableFirebasePhoneOtp
        ? 'Firebase phone verification is unavailable on this deployment, so secure backup OTP delivery is active for email and mobile.'
        : 'Secure backup OTP delivery is active. If the account details are valid, a 6-digit code has been sent to your email and mobile.',
    },
    resendSuccess: {
      title: disableFirebasePhoneOtp ? 'Backup Codes Re-Sent' : 'Backup OTP Re-Sent',
      detail: disableFirebasePhoneOtp
        ? 'Firebase phone verification is still unavailable here, so fresh backup OTP codes were sent to your email and mobile.'
        : 'Fresh backup OTP codes were sent. Enter the latest 6-digit code from your email or mobile channel.',
    },
  };
};
