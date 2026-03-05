const AppError = require('../../../utils/AppError');
const BaseSmsProvider = require('./baseProvider');
const { flags } = require('../../../config/otpSmsFlags');

const normalizeTwilioError = (error, statusCode) => {
    const message = String(error?.message || 'Failed to send OTP SMS via Twilio');
    const code = String(error?.code || error?.twilioCode || statusCode || 'TWILIO_SMS_ERROR');
    const retryable = Number(statusCode) >= 500 || code === 'ECONNRESET' || code === 'ETIMEDOUT';
    return { message, code, retryable };
};

const normalizeE164 = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    if (raw.startsWith('+')) {
        return `+${digits}`;
    }
    return `+${digits}`;
};

const toWhatsAppAddress = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.startsWith('whatsapp:')) return raw;
    const e164 = normalizeE164(raw);
    return e164 ? `whatsapp:${e164}` : '';
};

const toSmsAddress = (value) => normalizeE164(value);

const resolveTwilioRouting = ({ channel = 'sms', toPhone }) => {
    const resolvedChannel = channel === 'whatsapp' ? 'whatsapp' : 'sms';

    if (resolvedChannel === 'whatsapp') {
        const from = toWhatsAppAddress(flags.twilioWhatsappFrom || '');
        const to = toWhatsAppAddress(toPhone);
        if (!from) {
            throw new AppError('Twilio WhatsApp sender is not configured', 500);
        }
        if (!to) {
            throw new AppError('Invalid WhatsApp destination phone number', 400);
        }
        return { channel: resolvedChannel, from, to };
    }

    const from = toSmsAddress(flags.twilioFromNumber);
    const to = toSmsAddress(toPhone);
    if (!from) {
        throw new AppError('Twilio SMS sender is not configured', 500);
    }
    if (!to) {
        throw new AppError('Invalid SMS destination phone number', 400);
    }
    return { channel: resolvedChannel, from, to };
};

class TwilioProvider extends BaseSmsProvider {
    constructor() {
        super();
        if (!flags.twilioAccountSid || !flags.twilioAuthToken || !flags.twilioFromNumber) {
            throw new AppError('Twilio SMS provider is not configured', 500);
        }
    }

    async sendOtpSms({ toPhone, body, channel = 'sms' }) {
        if (!toPhone || !body) {
            throw new AppError('Invalid OTP SMS payload', 400);
        }

        if (typeof fetch !== 'function') {
            throw new AppError('Global fetch is unavailable for Twilio provider', 500);
        }

        const routing = resolveTwilioRouting({ channel, toPhone });

        const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(flags.twilioAccountSid)}/Messages.json`;
        const payload = new URLSearchParams({
            To: routing.to,
            From: routing.from,
            Body: body,
            ...(flags.twilioStatusCallbackUrl ? { StatusCallback: flags.twilioStatusCallbackUrl } : {}),
        });

        let response;
        try {
            response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${Buffer.from(`${flags.twilioAccountSid}:${flags.twilioAuthToken}`).toString('base64')}`,
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                },
                body: payload.toString(),
            });
        } catch (networkError) {
            const normalized = normalizeTwilioError(networkError, 503);
            const wrapped = new AppError(normalized.message, 503);
            wrapped.smsCode = normalized.code;
            wrapped.smsRetryable = normalized.retryable;
            throw wrapped;
        }

        let data = {};
        try {
            data = await response.json();
        } catch {
            data = {};
        }

        if (!response.ok) {
            const normalized = normalizeTwilioError(
                { message: data.message || response.statusText, code: data.code },
                response.status
            );
            const wrapped = new AppError(normalized.message, response.status >= 400 && response.status < 500 ? 400 : 503);
            wrapped.smsCode = normalized.code;
            wrapped.smsRetryable = normalized.retryable;
            wrapped.smsChannel = routing.channel;
            throw wrapped;
        }

        return {
            provider: 'twilio',
            channel: routing.channel,
            providerMessageId: String(data.sid || ''),
            response: data,
        };
    }
}

module.exports = TwilioProvider;
