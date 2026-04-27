export const OTP_LENGTH = 6;

export const OTP_TRANSPORT = {
  FIREBASE_SMS: 'firebase_sms',
  BACKEND_OTP: 'backend_otp',
};

export const OTP_STAGE = {
  SINGLE: 'single',
  EMAIL: 'email',
  PHONE: 'phone',
};

const AUTH_MODES = new Set(['signin', 'signup', 'forgot-password']);
const INTERNATIONAL_PHONE_REGEX = /^\+[1-9]\d{7,14}$/;

export const createEmptyOtpValues = () => Array(OTP_LENGTH).fill('');

export const createEmptyFormData = (overrides = {}) => ({
  name: '',
  email: '',
  phone: '',
  password: '',
  confirmPassword: '',
  ...overrides,
});

export const resolveLaunchMode = (value = '') => {
  const nextMode = String(value || '').trim();
  return AUTH_MODES.has(nextMode) ? nextMode : 'signin';
};

export const resolveLaunchPrefill = (state = null) => ({
  email: typeof state?.authPrefill?.email === 'string'
    ? state.authPrefill.email.trim().toLowerCase()
    : '',
  phone: typeof state?.authPrefill?.phone === 'string'
    ? state.authPrefill.phone.trim()
    : '',
});

export const getAuthPurpose = (mode = '') => (
  mode === 'forgot-password' ? 'forgot-password' : mode === 'signup' ? 'signup' : 'login'
);

export const normalizePhone = (phone = '') => String(phone).replace(/[\s\-()]/g, '').trim();

export const normalizeEmail = (email = '') => String(email).trim().toLowerCase();

export const validatePhone = (phone = '') => INTERNATIONAL_PHONE_REGEX.test(normalizePhone(phone));

export const validateEmail = (email = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));

export const buildGenericOtpFlowError = (t) => ({
  message: t(
    'login.error.genericOtpFlow',
    {},
    'If the account details are valid, continue with OTP verification.'
  ),
});

export const isEnumerationSensitiveOtpError = (err) => {
  const status = Number(err?.status || err?.response?.status || 0);
  const rawMessage = String(
    err?.response?.data?.message
    || err?.message
    || err?.error
    || ''
  ).toLowerCase();

  return status === 404
    || rawMessage.includes('no account found')
    || rawMessage.includes('does not match the account')
    || rawMessage.includes('phone mismatch')
    || rawMessage.includes('email mismatch');
};

export const shouldKeepSpecificOtpError = (err) => {
  const rawMessage = String(
    err?.response?.data?.message
    || err?.message
    || err?.error
    || ''
  ).toLowerCase();

  return rawMessage.includes('registered account')
    || rawMessage.includes('no verified account found')
    || rawMessage.includes('sign up first');
};
