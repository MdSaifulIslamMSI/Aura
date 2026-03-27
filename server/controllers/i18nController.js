const asyncHandler = require('express-async-handler');
const {
    normalizeSourceLanguage,
    normalizeTargetLanguage,
    translateTexts,
} = require('../services/i18n/translationService');

const translateBatch = asyncHandler(async (req, res) => {
    const targetLanguage = normalizeTargetLanguage(req.body?.language || req.market?.language);
    const sourceLanguage = normalizeSourceLanguage(req.body?.sourceLanguage || 'auto');
    const texts = Array.isArray(req.body?.texts) ? req.body.texts : [];
    const translations = await translateTexts({
        texts,
        targetLanguage,
        sourceLanguage,
    });

    res.json({
        status: 'success',
        language: targetLanguage,
        sourceLanguage,
        translations,
    });
});

module.exports = {
    translateBatch,
};
