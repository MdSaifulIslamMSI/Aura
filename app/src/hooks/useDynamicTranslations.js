import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMarket } from '@/context/MarketContext';
import { i18nApi } from '@/services/api/i18nApi';

const translationCache = new Map();
const hydratedLanguages = new Set();
const DYNAMIC_TRANSLATION_STORAGE_KEY = 'aura_dynamic_translation_cache_v1';
const MAX_PERSISTED_TRANSLATIONS_PER_LANGUAGE = 500;

const WHITESPACE_ONLY_PATTERN = /^\s*$/;
const NON_TRANSLATABLE_PATTERN = /^(https?:\/\/|www\.|mailto:|tel:|\/[A-Za-z0-9._/-]+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
const SYMBOL_ONLY_PATTERN = /^[\d\s.,:%$()+\-\/\\|[\]{}<>*_#@!?=&]+$/;
const IDENTIFIER_ONLY_PATTERN = /^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)+$/;
const REQUEST_SIGNATURE_PATTERN = /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+\/\S+$/i;
const CODE_TOKEN_PATTERN = /^(?:[A-Z]{2,}[A-Z0-9.+-]*|\d+[A-Za-z][A-Za-z0-9.+-]*|[A-Za-z]+-\d+[A-Za-z0-9.+-]*)$/;
const DIGIT_PATTERN = /\d/;

const areTranslationMapsEqual = (left = {}, right = {}) => {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);

    if (leftKeys.length !== rightKeys.length) {
        return false;
    }

    return leftKeys.every((key) => left[key] === right[key]);
};

const readPersistedTranslationStore = () => {
    if (typeof window === 'undefined') {
        return {};
    }

    try {
        return JSON.parse(window.localStorage.getItem(DYNAMIC_TRANSLATION_STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
};

const hydratePersistedTranslations = (language = 'en') => {
    const normalizedLanguage = String(language || 'en').trim().toLowerCase();
    if (!normalizedLanguage || normalizedLanguage === 'en' || hydratedLanguages.has(normalizedLanguage)) {
        return;
    }

    const persistedEntries = readPersistedTranslationStore()?.[normalizedLanguage] || {};
    Object.entries(persistedEntries).forEach(([source, value]) => {
        const normalizedSource = normalizeDynamicTranslationText(source);
        if (!normalizedSource) return;
        translationCache.set(`${normalizedLanguage}::${normalizedSource}`, String(value || normalizedSource));
    });
    hydratedLanguages.add(normalizedLanguage);
};

const persistTranslations = (language = 'en', entries = {}) => {
    const normalizedLanguage = String(language || 'en').trim().toLowerCase();
    const normalizedEntries = Object.fromEntries(
        Object.entries(entries || {})
            .map(([source, value]) => [normalizeDynamicTranslationText(source), String(value || source || '')])
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
        const persistedStore = readPersistedTranslationStore();
        const mergedEntries = {
            ...(persistedStore?.[normalizedLanguage] || {}),
            ...normalizedEntries,
        };
        persistedStore[normalizedLanguage] = Object.fromEntries(
            Object.entries(mergedEntries).slice(-MAX_PERSISTED_TRANSLATIONS_PER_LANGUAGE)
        );
        window.localStorage.setItem(DYNAMIC_TRANSLATION_STORAGE_KEY, JSON.stringify(persistedStore));
    } catch {
        // Ignore storage failures and keep using the in-memory cache.
    }
};

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

export const normalizeDynamicTranslationText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim();

export const preserveDynamicTranslationWhitespace = (source = '', translated = '') => {
    const original = String(source || '');
    const leading = original.match(/^\s*/)?.[0] || '';
    const trailing = original.match(/\s*$/)?.[0] || '';
    return `${leading}${String(translated || '').trim()}${trailing}`;
};

export const shouldTranslateDynamicText = (value = '') => {
    const normalized = normalizeDynamicTranslationText(value);
    if (!normalized || WHITESPACE_ONLY_PATTERN.test(String(value || ''))) return false;
    if (normalized.length < 2) return false;
    if (NON_TRANSLATABLE_PATTERN.test(normalized)) return false;
    if (SYMBOL_ONLY_PATTERN.test(normalized)) return false;
    if (isLikelyDynamicIdentifier(normalized)) return false;
    return /\p{L}/u.test(normalized);
};

export const collectDynamicTranslationTexts = (values = []) => [...new Set(
    (Array.isArray(values) ? values : [])
        .filter((value) => shouldTranslateDynamicText(value))
        .map((value) => normalizeDynamicTranslationText(value))
        .filter(Boolean)
)];

export const translateDynamicTextBatch = async ({
    texts = [],
    language = 'en',
    sourceLanguage = 'auto',
} = {}) => {
    hydratePersistedTranslations(language);

    const uniqueTexts = collectDynamicTranslationTexts(texts);

    if (language === 'en' || uniqueTexts.length === 0) {
        return {};
    }

    const missingTexts = uniqueTexts.filter((text) => !translationCache.has(`${language}::${text}`));

    if (missingTexts.length > 0) {
        try {
            const translated = await i18nApi.translateTexts({
                texts: missingTexts,
                language,
                sourceLanguage,
            });

            const persistedEntries = {};
            Object.entries(translated || {}).forEach(([source, value]) => {
                const normalizedSource = normalizeDynamicTranslationText(source);
                if (!normalizedSource) return;
                const translatedValue = String(value || normalizedSource);
                translationCache.set(`${language}::${normalizedSource}`, translatedValue);
                persistedEntries[normalizedSource] = translatedValue;
            });
            persistTranslations(language, persistedEntries);
        } catch {
            missingTexts.forEach((text) => {
                if (!translationCache.has(`${language}::${text}`)) {
                    translationCache.set(`${language}::${text}`, text);
                }
            });
        }
    }

    return Object.fromEntries(
        uniqueTexts.map((text) => [text, translationCache.get(`${language}::${text}`) || text])
    );
};

export const useDynamicTranslations = (values = [], { enabled = true } = {}) => {
    const market = useMarket();
    const language = market?.languageConfig?.code || market?.languageCode || market?.language || 'en';
    hydratePersistedTranslations(language);

    const translatableTexts = useMemo(
        () => (enabled ? collectDynamicTranslationTexts(values) : []),
        [enabled, values]
    );
    const signature = useMemo(() => translatableTexts.join('\u0001'), [translatableTexts]);
    const [translations, setTranslations] = useState({});

    useEffect(() => {
        if (!enabled || language === 'en' || translatableTexts.length === 0) {
            setTranslations((currentTranslations) => (
                Object.keys(currentTranslations).length === 0 ? currentTranslations : {}
            ));
            return undefined;
        }

        const cachedEntries = Object.fromEntries(
            translatableTexts
                .map((text) => [text, translationCache.get(`${language}::${text}`)])
                .filter(([, value]) => Boolean(value))
        );

        setTranslations((currentTranslations) => (
            areTranslationMapsEqual(currentTranslations, cachedEntries) ? currentTranslations : cachedEntries
        ));

        let cancelled = false;

        void translateDynamicTextBatch({
            texts: translatableTexts,
            language,
        }).then((nextTranslations) => {
            if (!cancelled) {
                setTranslations((currentTranslations) => (
                    areTranslationMapsEqual(currentTranslations, nextTranslations)
                        ? currentTranslations
                        : nextTranslations
                ));
            }
        });

        return () => {
            cancelled = true;
        };
    }, [enabled, language, signature]);

    const translateText = useCallback((value = '') => {
        const sourceText = String(value || '');
        if (!enabled || language === 'en' || !shouldTranslateDynamicText(sourceText)) {
            return sourceText;
        }

        const normalizedSource = normalizeDynamicTranslationText(sourceText);
        const cachedTranslation = translations[normalizedSource] || translationCache.get(`${language}::${normalizedSource}`);
        if (!cachedTranslation) {
            return sourceText;
        }

        return preserveDynamicTranslationWhitespace(sourceText, cachedTranslation);
    }, [enabled, language, translations]);

    return {
        translations,
        translateText,
    };
};
