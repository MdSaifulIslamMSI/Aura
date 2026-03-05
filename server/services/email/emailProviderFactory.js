const AppError = require('../../utils/AppError');
const GmailProvider = require('./providers/gmailProvider');
const { flags } = require('../../config/emailFlags');

let cachedProvider = null;

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
