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
  'auth/unauthorized-domain',
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
  const mentionsContentSecurityPolicy = message.includes('content security policy')
    || message.includes('frame-src')
    || message.includes('refused to frame')
    || message.includes('violates the following content security policy directive');
  const mentionsFirebaseAuthIframe = message.includes('firebaseapp.com')
    || message.includes('web.app')
    || message.includes('illegal url for new iframe');
  const mentionsBilling = message.includes('billing-not-enabled')
    || message.includes('billing not enabled')
    || message.includes('blaze plan');
  const mentionsDisabledProvider = message.includes('operation-not-allowed')
    || message.includes('provider is disabled')
    || message.includes('phone auth is not enabled');
  const mentionsUnauthorizedDomain = message.includes('unauthorized-domain')
    || message.includes('domain not authorized')
    || message.includes('app url is not allowed in firebase authentication')
    || message.includes('app-not-authorized');
  const mentionsRecaptchaBootstrapFailure = message.includes('failed to initialize recaptcha enterprise config')
    || message.includes('recaptcha enterprise');
  const mentionsRecaptchaUnauthorized = mentionsRecaptcha && message.includes('unauthorized');
  const mentionsIframeBootstrapBlock = mentionsContentSecurityPolicy && mentionsFirebaseAuthIframe;

  const shouldFallback = FALLBACK_CODES.has(code)
    || mentionsRecaptcha
    || mentionsBilling
    || mentionsDisabledProvider
    || mentionsUnauthorizedDomain
    || mentionsRecaptchaBootstrapFailure
    || mentionsIframeBootstrapBlock;

  if (!shouldFallback) {
    return null;
  }

  const disableFirebasePhoneOtp = SESSION_DISABLE_CODES.has(code)
    || mentionsBilling
    || mentionsDisabledProvider
    || mentionsContentSecurityPolicy
    || mentionsUnauthorizedDomain
    || mentionsRecaptchaBootstrapFailure
    || mentionsRecaptchaUnauthorized
    || mentionsIframeBootstrapBlock;

  return {
    code,
    message,
    disableFirebasePhoneOtp,
    success: {
      title: disableFirebasePhoneOtp ? 'Backup OTP Route Active' : 'Backup OTP Ready',
      detail: disableFirebasePhoneOtp
        ? 'Firebase phone verification is unavailable on this deployment, so secure backup OTP delivery is active through the available verification channel.'
        : 'Secure backup OTP delivery is active. If the account details are valid, a 6-digit code has been sent through the available verification channel.',
    },
    resendSuccess: {
      title: disableFirebasePhoneOtp ? 'Backup Codes Re-Sent' : 'Backup OTP Re-Sent',
      detail: disableFirebasePhoneOtp
        ? 'Firebase phone verification is still unavailable here, so fresh backup OTP codes were sent through the available verification channel.'
        : 'Fresh backup OTP codes were sent. Enter the latest 6-digit code from the verification channel you received.',
    },
  };
};
