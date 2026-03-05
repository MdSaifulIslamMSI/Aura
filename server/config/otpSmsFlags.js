const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parseInteger = (value, fallback, { min = 0, max = 120 } = {}) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < min) return min;
    if (parsed > max) return max;
    return parsed;
};

const trim = (value, fallback = '') => String(value || fallback).trim();

const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
const isProduction = nodeEnv === 'production';

const flags = {
    otpSmsEnabled: parseBoolean(process.env.OTP_SMS_ENABLED, true),
    otpSmsProvider: trim(process.env.OTP_SMS_PROVIDER, 'mock').toLowerCase(),
    otpSmsFailClosed: parseBoolean(process.env.OTP_SMS_FAIL_CLOSED, true),
    otpSmsSendInTest: parseBoolean(process.env.OTP_SMS_SEND_IN_TEST, false),
    otpWhatsappEnabled: parseBoolean(process.env.OTP_WHATSAPP_ENABLED, false),
    otpSmsTtlMinutes: parseInteger(process.env.OTP_SMS_TTL_MINUTES, 5, { min: 1, max: 30 }),
    otpSmsDefaultCountryCode: trim(process.env.OTP_SMS_DEFAULT_COUNTRY_CODE, '+91'),
    otpSmsBrand: trim(process.env.OTP_SMS_BRAND, 'AURA'),

    // Twilio
    twilioAccountSid: trim(process.env.TWILIO_ACCOUNT_SID, ''),
    twilioAuthToken: trim(process.env.TWILIO_AUTH_TOKEN, ''),
    twilioFromNumber: trim(process.env.TWILIO_FROM_NUMBER, ''),
    twilioWhatsappFrom: trim(process.env.TWILIO_WHATSAPP_FROM, ''),
    twilioStatusCallbackUrl: trim(process.env.TWILIO_STATUS_CALLBACK_URL, ''),
};

const assertProductionOtpSmsConfig = () => {
    if (!isProduction || !flags.otpSmsEnabled) return;

    if (flags.otpSmsProvider !== 'twilio') {
        throw new Error('OTP_SMS_PROVIDER must be "twilio" in production when OTP_SMS_ENABLED=true');
    }

    if (!flags.twilioAccountSid || !flags.twilioAuthToken || !flags.twilioFromNumber) {
        throw new Error('Missing Twilio OTP SMS credentials in production');
    }

    if (flags.otpWhatsappEnabled && !flags.twilioWhatsappFrom) {
        throw new Error('TWILIO_WHATSAPP_FROM is required in production when OTP_WHATSAPP_ENABLED=true');
    }
};

module.exports = {
    flags,
    parseBoolean,
    parseInteger,
    assertProductionOtpSmsConfig,
};
