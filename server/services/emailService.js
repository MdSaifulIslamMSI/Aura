const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { sendTransactionalEmail } = require('./email');
const { renderOtpTemplate } = require('./email/templates/otpTemplate');
const {
    maskIpAddress,
    getDeviceLabelFromUserAgent,
    toIstUtcTimestamp,
} = require('./email/templateUtils');
const { flags } = require('../config/otpEmailFlags');

const PURPOSE_LABELS = {
    signup: 'Account Signup',
    login: 'Login Verification',
    'forgot-password': 'Password Reset',
    'payment-challenge': 'Payment Challenge',
};

const safePurpose = (value) => {
    const key = String(value || '').trim();
    return PURPOSE_LABELS[key] ? key : 'login';
};

const buildOtpEmailContext = ({
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

const sendOtpEmail = async ({
    to,
    otp,
    purpose,
    context = {},
    requestId = '',
}) => {
    if (!to || !otp || !purpose) {
        throw new AppError('OTP email payload is incomplete', 400);
    }

    const resolvedPurpose = safePurpose(purpose);
    const renderedContext = flags.otpEmailContextEnabled
        ? buildOtpEmailContext({
            purpose: resolvedPurpose,
            ip: context.ip,
            userAgent: context.userAgent,
            requestTime: context.requestTime,
            location: context.location,
        })
        : {
            purposeLabel: PURPOSE_LABELS[resolvedPurpose],
            requestTime: '-',
            maskedIp: 'Unavailable',
            deviceLabel: 'Unavailable',
            locationLabel: 'Unavailable',
        };

    const rendered = renderOtpTemplate({
        otp,
        purpose: resolvedPurpose,
        context: renderedContext,
        ttlMinutes: flags.otpEmailTtlMinutes,
        brand: 'AURA',
    });

    try {
        const result = await sendTransactionalEmail({
            eventType: 'otp_security',
            to,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            requestId,
            headers: {
                'X-Aura-OTP-Purpose': resolvedPurpose,
            },
            meta: {
                requestId: String(requestId || ''),
                purpose: resolvedPurpose,
            },
            securityTags: ['otp', 'identity', resolvedPurpose],
        });

        logger.info('otp_email.sent', {
            requestId: String(requestId || ''),
            purpose: resolvedPurpose,
            recipient: String(to).replace(/(.{2}).*(@.*)/, '$1***$2'),
            provider: result.provider || 'unknown',
            messageId: result.providerMessageId || '',
        });

        return {
            provider: result.provider || 'unknown',
            providerMessageId: result.providerMessageId || '',
            response: result.response || {},
        };
    } catch (error) {
        logger.error('otp_email.failed', {
            requestId: String(requestId || ''),
            purpose: resolvedPurpose,
            recipient: String(to).replace(/(.{2}).*(@.*)/, '$1***$2'),
            code: error.emailCode || error.code || 'UNKNOWN_EMAIL_ERROR',
            retryable: error.emailRetryable !== undefined ? Boolean(error.emailRetryable) : null,
            error: error.message,
        });
        throw error;
    }
};

module.exports = {
    sendOtpEmail,
    buildOtpEmailContext,
};
