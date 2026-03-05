const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const { flags } = require('../../config/otpSmsFlags');
const { getSmsProvider } = require('./smsProviderFactory');
const { renderOtpSmsTemplate } = require('./templates/otpSmsTemplate');
const {
    maskIpAddress,
    getDeviceLabelFromUserAgent,
    toIstUtcTimestamp,
} = require('../email/templateUtils');

const PHONE_REGEX = /^\+?\d{10,15}$/;
const PURPOSE_LABELS = {
    signup: 'Account Signup',
    login: 'Login Verification',
    'forgot-password': 'Password Reset',
    'payment-challenge': 'Payment Challenge',
};

const isTwilioProvider = () => String(flags.otpSmsProvider || '').trim().toLowerCase() === 'twilio';

const safePurpose = (value) => {
    const key = String(value || '').trim();
    return PURPOSE_LABELS[key] ? key : 'login';
};

const maskPhone = (phone = '') => {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '***';
    const suffix = digits.slice(-4);
    return `***${suffix}`;
};

const normalizePhoneE164 = (value) => {
    const raw = String(value || '').trim();
    if (!PHONE_REGEX.test(raw)) {
        throw new AppError('Invalid phone number format for OTP SMS', 400);
    }

    const hasPlus = raw.startsWith('+');
    const digits = raw.replace(/\D/g, '');
    if (!digits || digits.length < 10 || digits.length > 15) {
        throw new AppError('Invalid phone number format for OTP SMS', 400);
    }

    if (hasPlus) {
        return `+${digits}`;
    }

    if (digits.length > 10) {
        return `+${digits}`;
    }

    const countryCodeDigits = String(flags.otpSmsDefaultCountryCode || '+91').replace(/\D/g, '') || '91';
    return `+${countryCodeDigits}${digits}`;
};

const buildOtpSmsContext = ({
    purpose,
    ip = '',
    userAgent = '',
    requestTime = new Date(),
    location = '',
}) => {
    const resolvedPurpose = safePurpose(purpose);
    const timestamp = toIstUtcTimestamp(requestTime);
    const locationLabel = String(location || '').trim() || 'Approximate location unavailable';

    return {
        purposeLabel: PURPOSE_LABELS[resolvedPurpose],
        requestTime: timestamp.display,
        maskedIp: maskIpAddress(ip),
        deviceLabel: getDeviceLabelFromUserAgent(userAgent),
        locationLabel,
    };
};

const sendOtpSms = async ({
    toPhone,
    otp,
    purpose,
    context = {},
    requestId = '',
}) => {
    if (!toPhone || !otp || !purpose) {
        throw new AppError('OTP SMS payload is incomplete', 400);
    }

    const resolvedPurpose = safePurpose(purpose);
    const normalizedPhone = normalizePhoneE164(toPhone);
    const renderedContext = buildOtpSmsContext({
        purpose: resolvedPurpose,
        ip: context.ip,
        userAgent: context.userAgent,
        requestTime: context.requestTime,
        location: context.location,
    });

    const rendered = renderOtpSmsTemplate({
        otp,
        purpose: resolvedPurpose,
        context: renderedContext,
        ttlMinutes: flags.otpSmsTtlMinutes,
        brand: flags.otpSmsBrand || 'AURA',
    });

    const provider = getSmsProvider();
    const channels = [];
    if (flags.otpWhatsappEnabled && isTwilioProvider()) {
        channels.push('whatsapp');
    }
    channels.push('sms');

    const failures = [];
    for (const channel of channels) {
        try {
            const result = await provider.sendOtpSms({
                toPhone: normalizedPhone,
                body: rendered.body,
                channel,
                meta: {
                    requestId: String(requestId || ''),
                    purpose: resolvedPurpose,
                },
            });

            logger.info('otp_sms.sent', {
                requestId: String(requestId || ''),
                purpose: resolvedPurpose,
                channel: result.channel || channel,
                recipient: maskPhone(normalizedPhone),
                provider: result.provider || 'unknown',
                messageId: result.providerMessageId || '',
            });

            return {
                provider: result.provider || 'unknown',
                channel: result.channel || channel,
                providerMessageId: result.providerMessageId || '',
                response: result.response || {},
            };
        } catch (error) {
            failures.push({
                channel,
                code: error.smsCode || error.code || 'UNKNOWN_SMS_ERROR',
                message: error.message,
            });
            logger.warn('otp_sms.channel_failed', {
                requestId: String(requestId || ''),
                purpose: resolvedPurpose,
                channel,
                recipient: maskPhone(normalizedPhone),
                code: error.smsCode || error.code || 'UNKNOWN_SMS_ERROR',
                error: error.message,
            });
        }
    }

    const finalFailure = failures[failures.length - 1] || { code: 'UNKNOWN_SMS_ERROR', message: 'OTP SMS delivery failed' };
    const combinedReason = failures.map((item) => `${item.channel}:${item.code}`).join(', ');
    const wrapped = new AppError(finalFailure.message || 'OTP SMS delivery failed', 503);
    wrapped.smsCode = finalFailure.code || 'UNKNOWN_SMS_ERROR';
    wrapped.smsRetryable = true;
    wrapped.smsFailures = failures;

    logger.error('otp_sms.failed', {
        requestId: String(requestId || ''),
        purpose: resolvedPurpose,
        recipient: maskPhone(normalizedPhone),
        code: wrapped.smsCode,
        retryable: wrapped.smsRetryable,
        error: combinedReason || wrapped.message,
    });

    throw wrapped;
};

const getOtpMobileChannels = () => {
    if (flags.otpWhatsappEnabled && isTwilioProvider()) {
        return ['whatsapp', 'sms'];
    }
    return ['sms'];
};

module.exports = {
    sendOtpSms,
    normalizePhoneE164,
    buildOtpSmsContext,
    getOtpMobileChannels,
};
