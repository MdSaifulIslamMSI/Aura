const logger = require('../../utils/logger');
const { flags } = require('../../config/otpSmsFlags');
const MockSmsProvider = require('./providers/mockProvider');
const TwilioProvider = require('./providers/twilioProvider');

const PROVIDERS = {
    mock: () => new MockSmsProvider(),
    twilio: () => new TwilioProvider(),
};

let cachedProvider = null;

const getSmsProvider = () => {
    if (cachedProvider) return cachedProvider;

    const providerKey = String(flags.otpSmsProvider || 'mock').trim().toLowerCase();
    const buildProvider = PROVIDERS[providerKey];

    if (!buildProvider) {
        logger.warn('sms.provider_unknown_fallback', {
            requestedProvider: providerKey,
            fallbackProvider: 'mock',
        });
        cachedProvider = new MockSmsProvider();
        return cachedProvider;
    }

    cachedProvider = buildProvider();
    return cachedProvider;
};

module.exports = {
    getSmsProvider,
};
