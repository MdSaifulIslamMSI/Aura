const { createCompositionalTranslationProvider } = require('./compositionalTranslationProvider');
const { createLibreTranslateProvider } = require('./libreTranslateProvider');
const { createMockTranslationProvider } = require('./mockTranslationProvider');
const { createNoopTranslationProvider } = require('./noopTranslationProvider');

const createTranslationProvider = (config = {}) => {
    if (config.providerName === 'compositional') {
        return createCompositionalTranslationProvider();
    }

    if (config.providerName === 'libretranslate') {
        return createLibreTranslateProvider({
            baseUrl: config.libreTranslateBaseUrl,
            timeoutMs: config.providerTimeoutMs,
        });
    }

    if (config.providerName === 'mock' && process.env.NODE_ENV !== 'production') {
        return createMockTranslationProvider();
    }

    return createNoopTranslationProvider();
};

module.exports = {
    createTranslationProvider,
};
