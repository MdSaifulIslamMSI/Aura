const {
    getRuntimeTranslationConfig,
    parseIntegerEnv,
} = require('../services/translation/translationConfig');

const getI18nHeavyUsagePolicy = () => ({
    maxAnonymousChars: parseIntegerEnv(process.env.I18N_TRANSLATION_ANON_MAX_CHARS, 1600, {
        min: 1,
        max: 4000,
    }),
    maxAnonymousTexts: parseIntegerEnv(process.env.I18N_TRANSLATION_ANON_MAX_TEXTS, 10, {
        min: 1,
        max: 50,
    }),
    requireAuthForHeavyUsage: getRuntimeTranslationConfig().requireAuthForHeavyUsage,
});

const requireAuthForHeavyTranslation = (req, res, next) => {
    const policy = getI18nHeavyUsagePolicy();
    if (!policy.requireAuthForHeavyUsage || req.user) {
        return next();
    }

    const texts = Array.isArray(req.body?.texts) ? req.body.texts : [];
    const totalChars = texts.reduce((total, text) => total + String(text || '').length, 0);
    const isHeavyUsage = texts.length > policy.maxAnonymousTexts || totalChars > policy.maxAnonymousChars;

    if (!isHeavyUsage) {
        return next();
    }

    return res.status(401).json({
        status: 'error',
        message: 'Sign in to translate larger batches.',
        code: 'I18N_TRANSLATION_AUTH_REQUIRED',
    });
};

module.exports = {
    getI18nHeavyUsagePolicy,
    requireAuthForHeavyTranslation,
};
