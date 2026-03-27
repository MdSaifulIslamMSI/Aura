import { apiFetch } from '../apiBase';

const MAX_BATCH_SIZE = 50;
const CACHE_TTL_MS = 10 * 60 * 1000;
const translationCache = new Map();
const inflightTranslationCache = new Map();

const normalizeText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();
const normalizeLanguage = (value = '', fallback = 'en') => String(value || fallback).trim().toLowerCase() || fallback;

const chunk = (values = [], size = MAX_BATCH_SIZE) => {
    const chunks = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
};

const getCacheKey = (language = 'en', sourceLanguage = 'auto', text = '') => (
    `${normalizeLanguage(language)}::${normalizeLanguage(sourceLanguage, 'auto')}::${normalizeText(text)}`
);

const readFromCache = (language, sourceLanguage, text) => {
    const entry = translationCache.get(getCacheKey(language, sourceLanguage, text));
    if (!entry) {
        return '';
    }

    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
        translationCache.delete(getCacheKey(language, sourceLanguage, text));
        return '';
    }

    return entry.value || '';
};

const writeToCache = (language, sourceLanguage, text, value) => {
    translationCache.set(getCacheKey(language, sourceLanguage, text), {
        value: String(value || text || ''),
        cachedAt: Date.now(),
    });
};

export const clearI18nApiCache = () => {
    translationCache.clear();
    inflightTranslationCache.clear();
};

export const i18nApi = {
    translateTexts: async ({
        texts = [],
        language,
        sourceLanguage = 'auto',
    } = {}) => {
        const targetLanguage = normalizeLanguage(language);
        const normalizedSourceLanguage = normalizeLanguage(sourceLanguage, 'auto');
        const normalizedTexts = [...new Set(
            (Array.isArray(texts) ? texts : [])
                .map(normalizeText)
                .filter(Boolean)
        )];

        if (normalizedTexts.length === 0) {
            return {};
        }

        if (targetLanguage === 'en') {
            return Object.fromEntries(normalizedTexts.map((text) => [text, text]));
        }

        const results = {};
        const pending = [];

        for (const batch of chunk(normalizedTexts, MAX_BATCH_SIZE)) {
            const uncachedTexts = [];

            batch.forEach((text) => {
                const cachedValue = readFromCache(targetLanguage, normalizedSourceLanguage, text);
                if (cachedValue) {
                    results[text] = cachedValue;
                    return;
                }

                const cacheKey = getCacheKey(targetLanguage, normalizedSourceLanguage, text);
                const inflight = inflightTranslationCache.get(cacheKey);
                if (inflight) {
                    pending.push(inflight.then((value) => {
                        results[text] = value;
                    }));
                    return;
                }

                uncachedTexts.push(text);
            });

            if (uncachedTexts.length === 0) {
                continue;
            }

            const batchRequest = apiFetch('/i18n/translate', {
                method: 'POST',
                timeoutMs: 20000,
                body: JSON.stringify({
                    texts: uncachedTexts,
                    language: targetLanguage,
                    sourceLanguage: normalizedSourceLanguage,
                }),
            })
                .then(({ data }) => data?.translations || {})
                .catch(() => ({}));

            uncachedTexts.forEach((text) => {
                const cacheKey = getCacheKey(targetLanguage, normalizedSourceLanguage, text);
                const translationPromise = batchRequest
                    .then((translations) => {
                        const value = String(translations[text] || text);
                        writeToCache(targetLanguage, normalizedSourceLanguage, text, value);
                        return value;
                    })
                    .finally(() => {
                        inflightTranslationCache.delete(cacheKey);
                    });

                inflightTranslationCache.set(cacheKey, translationPromise);
                pending.push(translationPromise.then((value) => {
                    results[text] = value;
                }));
            });
        }

        await Promise.all(pending);
        return results;
    },
};
