const nodemailer = require('nodemailer');
const AppError = require('../../../utils/AppError');
const BaseEmailProvider = require('./baseProvider');

const clampPositiveInt = (value, fallback, min, max) => {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isSafeInteger(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
};

// Pool defaults stay small for Gmail's per-account connection limits;
// raise via env on dedicated sending accounts only.
const getPoolMaxConnections = () => clampPositiveInt(process.env.GMAIL_POOL_MAX_CONNECTIONS, 3, 1, 10);
const getPoolMaxMessages = () => clampPositiveInt(process.env.GMAIL_POOL_MAX_MESSAGES, 100, 10, 1000);

class GmailProvider extends BaseEmailProvider {
    constructor({
        user,
        pass,
        fromName,
        fromAddress,
        replyTo = '',
    }) {
        super({ name: 'gmail' });
        this.user = String(user || '').trim();
        this.pass = String(pass || '').trim();
        this.fromName = String(fromName || '').trim();
        this.fromAddress = String(fromAddress || '').trim();
        this.replyTo = String(replyTo || '').trim();

        if (!this.user || !this.pass) {
            throw new AppError('Gmail provider credentials are missing', 500);
        }

        this.transporter = nodemailer.createTransport({
            service: 'gmail',
            pool: true,
            maxConnections: getPoolMaxConnections(),
            maxMessages: getPoolMaxMessages(),
            // nodemailer sockets have no default timeout; without these a wedged
            // SMTP connection holds the claimed order-email queue slot until the
            // stale-lock reaper runs.
            connectionTimeout: 15000,
            greetingTimeout: 15000,
            socketTimeout: 20000,
            auth: {
                user: this.user,
                pass: this.pass,
            },
        });
    }

    // eslint-disable-next-line class-methods-use-this
    normalizeError(error) {
        const code = String(error?.code || '').toUpperCase();
        const responseCode = Number(error?.responseCode || 0);

        if (code === 'EAUTH' || responseCode === 535) {
            return { code: 'AUTH_FAILED', retryable: false };
        }
        if (code === 'EENVELOPE' || responseCode === 550 || responseCode === 553) {
            return { code: 'INVALID_RECIPIENT', retryable: false };
        }
        if (responseCode === 421 || responseCode === 429 || responseCode === 451 || responseCode === 452) {
            return { code: 'RATE_LIMIT', retryable: true };
        }
        if (['ECONNECTION', 'ETIMEDOUT', 'ENOTFOUND', 'ESOCKET', 'ECONNRESET'].includes(code)) {
            return { code: 'NETWORK_ERROR', retryable: true };
        }
        if (responseCode >= 500 && responseCode <= 599) {
            return { code: 'PROVIDER_5XX', retryable: true };
        }
        return { code: 'UNKNOWN_EMAIL_ERROR', retryable: true };
    }

    async sendTransactionalEmail({
        to,
        subject,
        html,
        text = '',
        headers = {},
        meta = {},
    }) {
        try {
            if (!to || !subject || (!html && !text)) {
                throw new AppError('Invalid transactional email payload', 400);
            }

            const mailOptions = {
                from: `"${this.fromName}" <${this.fromAddress}>`,
                to,
                subject,
                html,
                text,
                headers,
                ...(this.replyTo ? { replyTo: this.replyTo } : {}),
            };

            const info = await this.transporter.sendMail(mailOptions);
            return {
                provider: this.name,
                providerMessageId: info.messageId || '',
                response: {
                    accepted: info.accepted || [],
                    rejected: info.rejected || [],
                    response: info.response || '',
                    envelope: info.envelope || {},
                    meta,
                },
            };
        } catch (error) {
            const normalized = this.normalizeError(error);
            const wrapped = new AppError(
                error?.message || 'Failed to send transactional email',
                normalized.retryable ? 503 : 400
            );
            wrapped.emailCode = normalized.code;
            wrapped.emailRetryable = normalized.retryable;
            wrapped.providerError = {
                code: normalized.code,
                responseCode: error?.responseCode || null,
                command: error?.command || '',
            };
            throw wrapped;
        }
    }
}

module.exports = GmailProvider;
