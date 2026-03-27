const fetch = require('node-fetch');
const logger = require('../../utils/logger');
const {
    DEFAULT_LANGUAGE_CODE,
    SUPPORTED_LANGUAGES,
    normalizeLanguageCode,
} = require('../markets/marketCatalog');

const TRANSLATION_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MAX_BATCH_SIZE = 50;
const MAX_TEXT_LENGTH = 800;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const translationCache = new Map();

const isSupportedLanguage = (value = '') => {
    const normalized = normalizeLanguageCode(value);
    return Boolean(normalized && Object.prototype.hasOwnProperty.call(SUPPORTED_LANGUAGES, normalized));
};

const normalizeTargetLanguage = (value = DEFAULT_LANGUAGE_CODE) => {
    const normalized = normalizeLanguageCode(value);
    return isSupportedLanguage(normalized) ? normalized : DEFAULT_LANGUAGE_CODE;
};

const normalizeSourceLanguage = (value = 'auto') => {
    const normalized = normalizeLanguageCode(value);
    return isSupportedLanguage(normalized) ? normalized : 'auto';
};

const normalizeText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

const getCacheKey = (language, text) => `${language}::${text}`;

const readFromCache = (language, text) => {
    const entry = translationCache.get(getCacheKey(language, text));
    if (!entry) return '';
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
        translationCache.delete(getCacheKey(language, text));
        return '';
    }
    return entry.value || '';
};

const writeToCache = (language, text, value) => {
    translationCache.set(getCacheKey(language, text), {
        value: String(value || ''),
        cachedAt: Date.now(),
    });
};

const parseTranslatedText = (payload) => {
    const segments = Array.isArray(payload?.[0]) ? payload[0] : [];
    const translated = segments
        .map((segment) => (Array.isArray(segment) ? String(segment[0] || '') : ''))
        .join('')
        .trim();
    return translated;
};

const translateSingleText = async ({
    text,
    targetLanguage,
    sourceLanguage = 'auto',
}) => {
    const query = new URLSearchParams({
        client: 'gtx',
        sl: normalizeSourceLanguage(sourceLanguage),
        tl: normalizeTargetLanguage(targetLanguage),
        dt: 't',
        q: text,
    });

    const response = await fetch(`${TRANSLATION_ENDPOINT}?${query.toString()}`, {
        timeout: 8000,
        headers: {
            Accept: 'application/json',
            'User-Agent': 'AuraCommerce/1.0',
        },
    });

    if (!response.ok) {
        throw new Error(`Translation upstream returned ${response.status}`);
    }

    const payload = await response.json();
    return parseTranslatedText(payload) || text;
};

const clearTranslationCache = () => {
    translationCache.clear();
};

const translateTexts = async ({
    texts = [],
    targetLanguage = DEFAULT_LANGUAGE_CODE,
    sourceLanguage = 'auto',
} = {}) => {
    const normalizedTarget = normalizeTargetLanguage(targetLanguage);
    const uniqueTexts = [...new Set(
        (Array.isArray(texts) ? texts : [])
            .map(normalizeText)
            .filter(Boolean)
            .slice(0, MAX_BATCH_SIZE)
    )];

    const results = {};

    for (const text of uniqueTexts) {
        if (text.length > MAX_TEXT_LENGTH) {
            results[text] = text;
            continue;
        }

        const cachedValue = readFromCache(normalizedTarget, text);
        if (cachedValue) {
            results[text] = cachedValue;
            continue;
        }

        try {
            const translated = await translateSingleText({
                text,
                targetLanguage: normalizedTarget,
                sourceLanguage,
            });
            results[text] = translated;
            writeToCache(normalizedTarget, text, translated);
        } catch (error) {
            logger.warn('i18n.translation_upstream_failed', {
                targetLanguage: normalizedTarget,
                sourceLanguage: normalizeSourceLanguage(sourceLanguage),
                textPreview: text.slice(0, 120),
                error: error?.message || 'unknown_error',
            });
            results[text] = text;
        }
    }

    return results;
};

module.exports = {
    clearTranslationCache,
    normalizeSourceLanguage,
    normalizeTargetLanguage,
    translateTexts,
};
