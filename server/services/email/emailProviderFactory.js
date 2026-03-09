const AppError = require('../../utils/AppError');
const GmailProvider = require('./providers/gmailProvider');
const ResendProvider = require('./providers/resendProvider');
const BaseEmailProvider = require('./providers/baseProvider');
const { flags } = require('../../config/emailFlags');

let cachedProvider = null;

// NullProvider: returned when email is not configured.
// Logs a warning and skips sending instead of crashing the server.
// This prevents startup failures when GMAIL_USER/RESEND_API_KEY are not set.
class NullEmailProvider extends BaseEmailProvider {
    constructor() { super({ name: 'null' }); }
    async sendTransactionalEmail({ to, subject }) {
        const logger = require('../../utils/logger');
        logger.warn('email_provider.null_skip', {
            to: String(to || '').slice(0, 40),
            subject: String(subject || '').slice(0, 80),
            reason: 'No email provider configured. Set ORDER_EMAIL_PROVIDER and credentials.',
        });
        return { provider: 'null', providerMessageId: '', skipped: true, response: {} };
    }
}

const createProvider = () => {
    switch (flags.orderEmailProvider) {
        case 'gmail':
            return new GmailProvider({
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_APP_PASSWORD,
                fromName: flags.orderEmailFromName,
                fromAddress: flags.orderEmailFromAddress,
                replyTo: flags.orderEmailReplyTo,
            });
        case 'resend':
            return new ResendProvider({
                apiKey: process.env.RESEND_API_KEY,
                fromName: flags.orderEmailFromName,
                fromAddress: flags.orderEmailFromAddress,
                replyTo: flags.orderEmailReplyTo,
            });
        case 'null':
        case 'none':
        case 'disabled':
            return new NullEmailProvider();
        default:
            throw new AppError(`Unsupported email provider: ${flags.orderEmailProvider}`, 500);
    }
};

const getEmailProvider = () => {
    if (!cachedProvider) {
        cachedProvider = createProvider();
    }
    return cachedProvider;
};

const resetEmailProviderForTests = () => {
    cachedProvider = null;
};

module.exports = {
    getEmailProvider,
    resetEmailProviderForTests,
};
