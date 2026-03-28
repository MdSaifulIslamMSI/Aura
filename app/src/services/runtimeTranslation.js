import { i18nApi } from '@/services/api/i18nApi';

const SHARED_RUNTIME_TRANSLATION_STORAGE_KEY = 'aura_runtime_translation_cache_v2';
const LEGACY_RUNTIME_TRANSLATION_STORAGE_KEYS = [
    'aura_runtime_translation_cache_v1',
    'aura_dynamic_translation_cache_v1',
];
const MAX_PERSISTED_TRANSLATIONS_PER_LANGUAGE = 500;

const WHITESPACE_ONLY_PATTERN = /^\s*$/;
const NON_TRANSLATABLE_PATTERN = /^(https?:\/\/|www\.|mailto:|tel:|\/[A-Za-z0-9._/-]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
const SYMBOL_ONLY_PATTERN = /^[\d\s.,:%$()+\-\/\\|[\]{}<>*_#@!?=&]+$/;
const IDENTIFIER_ONLY_PATTERN = /^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)+$/;
const REQUEST_SIGNATURE_PATTERN = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+\/\S+$/i;
const CODE_TOKEN_PATTERN = /^(?:[A-Z]{2,}[A-Z0-9.+-]*|\d+[A-Za-z][A-Za-z0-9.+-]*|[A-Za-z]+-\d+[A-Za-z0-9.+-]*)$/;
const DIGIT_PATTERN = /\d/;

const runtimeTranslationCache = new Map();
const hydratedRuntimeTranslationLanguages = new Set();

export const clearRuntimeTranslationCache = () => {
    runtimeTranslationCache.clear();
    hydratedRuntimeTranslationLanguages.clear();
};

const normalizeRuntimeTranslationLanguage = (language = 'en') => String(language || 'en').trim().toLowerCase() || 'en';
const getRuntimeTranslationCacheKey = (language = 'en', text = '') => `${normalizeRuntimeTranslationLanguage(language)}::${normalizeRuntimeTranslationText(text)}`;

const isLikelyDynamicIdentifier = (normalized = '') => {
    if (!normalized) return false;
    if (IDENTIFIER_ONLY_PATTERN.test(normalized)) return true;
    if (REQUEST_SIGNATURE_PATTERN.test(normalized)) return true;
    if (!/\s/.test(normalized) && CODE_TOKEN_PATTERN.test(normalized)) return true;

    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (tokens.length === 0 || tokens.length > 3) return false;

    const codeLikeTokenCount = tokens.filter((token) => (
        /^\d+$/.test(token)
        || CODE_TOKEN_PATTERN.test(token)
    )).length;

    return codeLikeTokenCount === tokens.length
        && tokens.some((token) => DIGIT_PATTERN.test(token));
};

export const normalizeRuntimeTranslationText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

export const preserveRuntimeTranslationWhitespace = (source = '', translated = '') => {
    const original = String(source || '');
    const leading = original.match(/^\s*/)?.[0] || '';
    const trailing = original.match(/\s*$/)?.[0] || '';
    return `${leading}${String(translated || '').trim()}${trailing}`;
};

export const shouldTranslateRuntimeText = (value = '') => {
    const normalized = normalizeRuntimeTranslationText(value);
    if (!normalized || WHITESPACE_ONLY_PATTERN.test(String(value || ''))) return false;
    if (normalized.length < 2) return false;
    if (NON_TRANSLATABLE_PATTERN.test(normalized)) return false;
    if (SYMBOL_ONLY_PATTERN.test(normalized)) return false;
    if (isLikelyDynamicIdentifier(normalized)) return false;
    return /\p{L}/u.test(normalized);
};

export const collectRuntimeTranslationTexts = (values = []) => [...new Set(
    (Array.isArray(values) ? values : [])
        .filter((value) => shouldTranslateRuntimeText(value))
        .map((value) => normalizeRuntimeTranslationText(value))
        .filter(Boolean)
)];

const readPersistedRuntimeTranslationStore = () => {
    if (typeof window === 'undefined') {
        return {};
    }

    const mergedStore = {};

    [...LEGACY_RUNTIME_TRANSLATION_STORAGE_KEYS, SHARED_RUNTIME_TRANSLATION_STORAGE_KEY].forEach((storageKey) => {
        try {
            const parsedStore = JSON.parse(window.localStorage.getItem(storageKey) || '{}');
            Object.entries(parsedStore || {}).forEach(([language, entries]) => {
                mergedStore[language] = {
                    ...(mergedStore[language] || {}),
                    ...(entries || {}),
                };
            });
        } catch {
            // Ignore corrupt persisted entries and continue with the next store.
        }
    });

    return mergedStore;
};

const persistRuntimeTranslations = (language = 'en', entries = {}) => {
    const normalizedLanguage = normalizeRuntimeTranslationLanguage(language);
    const normalizedEntries = Object.fromEntries(
        Object.entries(entries || {})
            .map(([source, value]) => [normalizeRuntimeTranslationText(source), String(value || source || '')])
            .filter(([source]) => Boolean(source))
    );

    if (
        typeof window === 'undefined'
        || !normalizedLanguage
        || normalizedLanguage === 'en'
        || Object.keys(normalizedEntries).length === 0
    ) {
        return;
    }

    try {
        const persistedStore = readPersistedRuntimeTranslationStore();
        const mergedEntries = {
            ...(persistedStore?.[normalizedLanguage] || {}),
            ...normalizedEntries,
        };
        const trimmedEntries = Object.fromEntries(
            Object.entries(mergedEntries).slice(-MAX_PERSISTED_TRANSLATIONS_PER_LANGUAGE)
        );
        persistedStore[normalizedLanguage] = trimmedEntries;
        window.localStorage.setItem(SHARED_RUNTIME_TRANSLATION_STORAGE_KEY, JSON.stringify(persistedStore));
    } catch {
        // Ignore storage failures and keep using the in-memory cache.
    }
};

export const hydrateRuntimeTranslations = (language = 'en') => {
    const normalizedLanguage = normalizeRuntimeTranslationLanguage(language);
    if (!normalizedLanguage || normalizedLanguage === 'en' || hydratedRuntimeTranslationLanguages.has(normalizedLanguage)) {
        return;
    }

    const persistedEntries = readPersistedRuntimeTranslationStore()?.[normalizedLanguage] || {};
    Object.entries(persistedEntries).forEach(([source, value]) => {
        const normalizedSource = normalizeRuntimeTranslationText(source);
        if (!normalizedSource) return;
        runtimeTranslationCache.set(getRuntimeTranslationCacheKey(normalizedLanguage, normalizedSource), String(value || normalizedSource));
    });
    hydratedRuntimeTranslationLanguages.add(normalizedLanguage);
};

export const getCachedRuntimeTranslation = ({
    language = 'en',
    text = '',
} = {}) => {
    const normalizedLanguage = normalizeRuntimeTranslationLanguage(language);
    const normalizedText = normalizeRuntimeTranslationText(text);

    if (!normalizedText || normalizedLanguage === 'en') {
        return normalizedText || String(text || '');
    }

    hydrateRuntimeTranslations(normalizedLanguage);
    return runtimeTranslationCache.get(getRuntimeTranslationCacheKey(normalizedLanguage, normalizedText)) || '';
};

export const getCachedRuntimeTranslations = ({
    language = 'en',
    texts = [],
} = {}) => {
    const normalizedLanguage = normalizeRuntimeTranslationLanguage(language);
    const normalizedTexts = collectRuntimeTranslationTexts(texts);

    if (normalizedLanguage === 'en' || normalizedTexts.length === 0) {
        return {};
    }

    hydrateRuntimeTranslations(normalizedLanguage);

    return Object.fromEntries(
        normalizedTexts
            .map((text) => [text, runtimeTranslationCache.get(getRuntimeTranslationCacheKey(normalizedLanguage, text))])
            .filter(([, value]) => Boolean(value))
    );
};

export const requestRuntimeTranslations = async ({
    texts = [],
    language = 'en',
    sourceLanguage = 'auto',
} = {}) => {
    const normalizedLanguage = normalizeRuntimeTranslationLanguage(language);
    const uniqueTexts = collectRuntimeTranslationTexts(texts);

    hydrateRuntimeTranslations(normalizedLanguage);

    if (normalizedLanguage === 'en' || uniqueTexts.length === 0) {
        return {};
    }

    const missingTexts = uniqueTexts.filter((text) => !runtimeTranslationCache.has(getRuntimeTranslationCacheKey(normalizedLanguage, text)));

    if (missingTexts.length > 0) {
        try {
            const translated = await i18nApi.translateTexts({
                texts: missingTexts,
                language: normalizedLanguage,
                sourceLanguage,
            });

            const persistedEntries = {};
            Object.entries(translated || {}).forEach(([source, value]) => {
                const normalizedSource = normalizeRuntimeTranslationText(source);
                if (!normalizedSource) return;
                const translatedValue = String(value || normalizedSource);
                runtimeTranslationCache.set(getRuntimeTranslationCacheKey(normalizedLanguage, normalizedSource), translatedValue);
                persistedEntries[normalizedSource] = translatedValue;
            });
            persistRuntimeTranslations(normalizedLanguage, persistedEntries);
        } catch {
            missingTexts.forEach((text) => {
                if (!runtimeTranslationCache.has(getRuntimeTranslationCacheKey(normalizedLanguage, text))) {
                    runtimeTranslationCache.set(getRuntimeTranslationCacheKey(normalizedLanguage, text), text);
                }
            });
        }
    }

    return Object.fromEntries(
        uniqueTexts.map((text) => [
            text,
            runtimeTranslationCache.get(getRuntimeTranslationCacheKey(normalizedLanguage, text)) || text,
        ])
    );
};
