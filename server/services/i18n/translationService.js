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
const TRANSLATION_CONCURRENCY = 6;

const translationCache = new Map();
const inflightTranslationCache = new Map();

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

const getCacheKey = (language, sourceLanguage, text) => `${language}::${sourceLanguage}::${text}`;

const readFromCache = (language, sourceLanguage, text) => {
    const entry = translationCache.get(getCacheKey(language, sourceLanguage, text));
    if (!entry) return '';
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
        translationCache.delete(getCacheKey(language, sourceLanguage, text));
        return '';
    }
    return entry.value || '';
};

const writeToCache = (language, sourceLanguage, text, value) => {
    translationCache.set(getCacheKey(language, sourceLanguage, text), {
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
    inflightTranslationCache.clear();
};

const runWithConcurrency = async (items = [], worker, concurrency = TRANSLATION_CONCURRENCY) => {
    const normalizedItems = Array.isArray(items) ? items : [];
    if (normalizedItems.length === 0) {
        return;
    }

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

const createFallbackTranslation = ({
    error,
    normalizedSourceLanguage,
    normalizedTarget,
    text,
}) => {
    logger.warn('i18n.translation_upstream_failed', {
        targetLanguage: normalizedTarget,
        sourceLanguage: normalizedSourceLanguage,
        textPreview: text.slice(0, 120),
        error: error?.message || 'unknown_error',
    });
    return text;
};

const getOrCreateTranslationPromise = ({
    normalizedSourceLanguage,
    normalizedTarget,
    text,
}) => {
    if (
        !text
        || text.length > MAX_TEXT_LENGTH
        || normalizedTarget === DEFAULT_LANGUAGE_CODE
        || (normalizedSourceLanguage !== 'auto' && normalizedSourceLanguage === normalizedTarget)
    ) {
        return Promise.resolve(text);
    }

    const cachedValue = readFromCache(normalizedTarget, normalizedSourceLanguage, text);
    if (cachedValue) {
        return Promise.resolve(cachedValue);
    }

    const cacheKey = getCacheKey(normalizedTarget, normalizedSourceLanguage, text);
    const inflightPromise = inflightTranslationCache.get(cacheKey);
    if (inflightPromise) {
        return inflightPromise;
    }

    const translationPromise = translateSingleText({
        text,
        targetLanguage: normalizedTarget,
        sourceLanguage: normalizedSourceLanguage,
    })
        .then((translated) => {
            const resolvedTranslation = translated || text;
            writeToCache(normalizedTarget, normalizedSourceLanguage, text, resolvedTranslation);
            return resolvedTranslation;
        })
        .catch((error) => createFallbackTranslation({
            error,
            normalizedSourceLanguage,
            normalizedTarget,
            text,
        }))
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
    const normalizedTarget = normalizeTargetLanguage(targetLanguage);
    const normalizedSourceLanguage = normalizeSourceLanguage(sourceLanguage);
    const uniqueTexts = [...new Set(
        (Array.isArray(texts) ? texts : [])
            .map(normalizeText)
            .filter(Boolean)
            .slice(0, MAX_BATCH_SIZE)
    )];

    const results = {};

    await runWithConcurrency(uniqueTexts, async (text) => {
        results[text] = await getOrCreateTranslationPromise({
            normalizedSourceLanguage,
            normalizedTarget,
            text,
        });
    });

    return results;
};

module.exports = {
    clearTranslationCache,
    normalizeSourceLanguage,
    normalizeTargetLanguage,
    translateTexts,
};
