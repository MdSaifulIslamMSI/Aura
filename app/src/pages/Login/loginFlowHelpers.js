import {
  DEFAULT_PHONE_COUNTRY_CODE,
  getPhoneCountryOption,
  PHONE_COUNTRY_OPTIONS,
} from '@/config/phoneCountryOptions';

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
const PRIMARY_COUNTRY_BY_SHARED_DIAL_CODE = {
  '+1': 'US',
  '+7': 'RU',
  '+39': 'IT',
  '+44': 'GB',
  '+47': 'NO',
  '+61': 'AU',
  '+212': 'MA',
  '+262': 'RE',
  '+358': 'FI',
  '+590': 'GP',
  '+599': 'CW',
};

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

const normalizePhoneCountryCode = (countryCode = DEFAULT_PHONE_COUNTRY_CODE) => (
  getPhoneCountryOption(countryCode)?.countryCode || DEFAULT_PHONE_COUNTRY_CODE
);

const getDialCodeMatch = (normalizedPhone = '', fallbackCountryCode = DEFAULT_PHONE_COUNTRY_CODE) => {
  const fallbackOption = getPhoneCountryOption(fallbackCountryCode);

  if (fallbackOption && normalizedPhone.startsWith(fallbackOption.dialCode)) {
    return fallbackOption;
  }

  const primarySharedOption = Object.entries(PRIMARY_COUNTRY_BY_SHARED_DIAL_CODE)
    .sort(([firstDialCode], [secondDialCode]) => secondDialCode.length - firstDialCode.length)
    .find(([dialCode]) => normalizedPhone.startsWith(dialCode));

  if (primarySharedOption) {
    return getPhoneCountryOption(primarySharedOption[1]);
  }

  return [...PHONE_COUNTRY_OPTIONS]
    .sort((first, second) => second.dialCode.length - first.dialCode.length)
    .find((option) => normalizedPhone.startsWith(option.dialCode));
};

export const resolvePhoneCountryCode = (
  phone = '',
  fallbackCountryCode = DEFAULT_PHONE_COUNTRY_CODE
) => {
  const normalizedPhone = normalizePhone(phone);
  const fallback = normalizePhoneCountryCode(fallbackCountryCode);
  if (!normalizedPhone.startsWith('+')) return fallback;

  return getDialCodeMatch(normalizedPhone, fallback)?.countryCode || fallback;
};

export const getPhoneNationalInputValue = (
  phone = '',
  countryCode = DEFAULT_PHONE_COUNTRY_CODE
) => {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return '';

  const selectedOption = getPhoneCountryOption(countryCode);
  if (selectedOption && normalizedPhone.startsWith(selectedOption.dialCode)) {
    return normalizedPhone.slice(selectedOption.dialCode.length);
  }

  const matchedOption = getDialCodeMatch(normalizedPhone, countryCode);
  if (matchedOption) {
    return normalizedPhone.slice(matchedOption.dialCode.length);
  }

  return normalizedPhone.replace(/^\+/, '');
};

export const buildInternationalPhoneNumber = (
  phoneInput = '',
  countryCode = DEFAULT_PHONE_COUNTRY_CODE
) => {
  const normalizedInput = normalizePhone(phoneInput);
  if (!normalizedInput) return '';
  if (normalizedInput.startsWith('+')) return normalizedInput;

  const digits = normalizedInput.replace(/\D/g, '');
  if (!digits) return '';

  const selectedOption = getPhoneCountryOption(countryCode);
  return `${selectedOption.dialCode}${digits}`;
};

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
