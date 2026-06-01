const logger = require('../../utils/logger');
const {
    clearTranslationCache,
    getTranslationCacheKey,
    hashValue,
    readTranslationCache,
    writeTranslationCache,
} = require('./translationCache');
const {
    DEFAULT_LANGUAGE_CODE,
    getRuntimeTranslationConfig,
    normalizeLanguage,
    normalizeSourceLanguage,
} = require('./translationConfig');
const { redactTranslationText, restoreTranslationText } = require('./translationPrivacy');
const { createTranslationProvider } = require('./providers');

const normalizeText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const runWithConcurrency = async (items = [], worker, concurrency = 4) => {
    const normalizedItems = Array.isArray(items) ? items : [];
    if (normalizedItems.length === 0) return;

    const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, normalizedItems.length));
    let nextIndex = 0;

    await Promise.all(Array.from({ length: workerCount }, async () => {
        while (nextIndex < normalizedItems.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            await worker(normalizedItems[currentIndex], currentIndex);
        }
    }));
};

const createRuntimeTranslationService = () => {
    const config = getRuntimeTranslationConfig();
    const provider = createTranslationProvider(config);
    const inflightTranslationCache = new Map();

    const translateOne = async ({
        normalizedSourceLanguage,
        normalizedTargetLanguage,
        text,
    }) => {
        if (
            !text
            || text.length > config.maxTextLength
            || normalizedTargetLanguage === DEFAULT_LANGUAGE_CODE
            || (
                normalizedSourceLanguage !== 'auto'
                && normalizedSourceLanguage === normalizedTargetLanguage
            )
        ) {
            return text;
        }

        const privacy = redactTranslationText(text);
        const cacheKey = getTranslationCacheKey({
            glossaryVersion: config.glossaryVersion,
            providerName: provider.name,
            sourceLanguage: normalizedSourceLanguage,
            targetLanguage: normalizedTargetLanguage,
            text,
        });

        if (config.cacheEnabled && !privacy.hasSensitiveData) {
            const cachedValue = readTranslationCache(cacheKey, config.cacheTtlMs);
            if (cachedValue) return cachedValue;
        }

        const inflightTranslation = inflightTranslationCache.get(cacheKey);
        if (inflightTranslation) {
            return inflightTranslation;
        }

        const translationPromise = provider.translateText({
            sourceLanguage: normalizedSourceLanguage,
            targetLanguage: normalizedTargetLanguage,
            text: privacy.redactedText,
            timeoutMs: config.providerTimeoutMs,
        })
            .then((translatedText) => {
                const restoredText = restoreTranslationText(
                    translatedText || privacy.redactedText,
                    privacy.replacements
                ) || text;

                if (config.cacheEnabled && !privacy.hasSensitiveData) {
                    writeTranslationCache(cacheKey, restoredText);
                }

                return restoredText;
            })
            .catch((error) => {
                logger.warn('i18n.translation_provider_failed', {
                    error: error?.message || 'unknown_error',
                    provider: provider.name,
                    sourceLanguage: normalizedSourceLanguage,
                    targetLanguage: normalizedTargetLanguage,
                    textHash: hashValue(text),
                });
                return text;
            })
            .finally(() => {
                inflightTranslationCache.delete(cacheKey);
            });

        inflightTranslationCache.set(cacheKey, translationPromise);
        return translationPromise;
    };

    const translateTexts = async ({
        texts = [],
        targetLanguage = DEFAULT_LANGUAGE_CODE,
        sourceLanguage = 'auto',
    } = {}) => {
        const normalizedTargetLanguage = normalizeLanguage(targetLanguage, DEFAULT_LANGUAGE_CODE);
        const normalizedSourceLanguage = normalizeSourceLanguage(sourceLanguage);
        const uniqueTexts = [...new Set(
            (Array.isArray(texts) ? texts : [])
                .map(normalizeText)
                .filter(Boolean)
                .slice(0, config.maxBatchSize)
        )];
        const results = {};

        await runWithConcurrency(uniqueTexts, async (text) => {
            results[text] = await translateOne({
                normalizedSourceLanguage,
                normalizedTargetLanguage,
                text,
            });
        });

        return results;
    };

    return {
        clearCache: clearTranslationCache,
        config,
        providerName: provider.name,
        translateTexts,
    };
};

module.exports = {
    createRuntimeTranslationService,
    normalizeText,
};
