const {
    DEFAULT_LANGUAGE_CODE,
    normalizeLanguage,
    normalizeSourceLanguage,
} = require('../translation/translationConfig');
const { createRuntimeTranslationService } = require('../translation/TranslationService');
const { clearTranslationCache } = require('../translation/translationCache');

const normalizeTargetLanguage = (value = DEFAULT_LANGUAGE_CODE) => normalizeLanguage(value, DEFAULT_LANGUAGE_CODE);

let runtimeTranslationService = createRuntimeTranslationService();

const translateTexts = async ({
    texts = [],
    targetLanguage = DEFAULT_LANGUAGE_CODE,
    sourceLanguage = 'auto',
} = {}) => {
    runtimeTranslationService = runtimeTranslationService || createRuntimeTranslationService();
    return runtimeTranslationService.translateTexts({
        texts,
        targetLanguage,
        sourceLanguage,
    });
};

module.exports = {
    clearTranslationCache: () => {
        clearTranslationCache();
        runtimeTranslationService = createRuntimeTranslationService();
    },
    normalizeSourceLanguage,
    normalizeTargetLanguage,
    translateTexts,
};
