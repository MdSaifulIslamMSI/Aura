import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMarket } from '@/context/MarketContext';
import {
    collectRuntimeTranslationTexts,
    getCachedRuntimeTranslation,
    getCachedRuntimeTranslations,
    normalizeRuntimeTranslationText,
    preserveRuntimeTranslationWhitespace,
    requestRuntimeTranslations,
    shouldTranslateRuntimeText,
} from '@/services/runtimeTranslation';

const areTranslationMapsEqual = (left = {}, right = {}) => {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);

    if (leftKeys.length !== rightKeys.length) {
        return false;
    }

    return leftKeys.every((key) => left[key] === right[key]);
};

export const normalizeDynamicTranslationText = normalizeRuntimeTranslationText;
export const preserveDynamicTranslationWhitespace = preserveRuntimeTranslationWhitespace;
export const shouldTranslateDynamicText = shouldTranslateRuntimeText;
export const collectDynamicTranslationTexts = collectRuntimeTranslationTexts;
export const translateDynamicTextBatch = requestRuntimeTranslations;

export const useDynamicTranslations = (values = [], { enabled = true } = {}) => {
    const market = useMarket();
    const language = market?.languageConfig?.code || market?.languageCode || market?.language || 'en';

    const translatableTexts = useMemo(
        () => (enabled ? collectDynamicTranslationTexts(values) : []),
        [enabled, values]
    );
    const signature = useMemo(() => translatableTexts.join('\u0001'), [translatableTexts]);
    const [translations, setTranslations] = useState(() => getCachedRuntimeTranslations({
        language,
        texts: translatableTexts,
    }));

    useEffect(() => {
        if (!enabled || language === 'en' || translatableTexts.length === 0) {
            setTranslations((currentTranslations) => (
                Object.keys(currentTranslations).length === 0 ? currentTranslations : {}
            ));
            return undefined;
        }

        const cachedEntries = getCachedRuntimeTranslations({
            language,
            texts: translatableTexts,
        });

        setTranslations((currentTranslations) => (
            areTranslationMapsEqual(currentTranslations, cachedEntries) ? currentTranslations : cachedEntries
        ));

        let cancelled = false;

        void requestRuntimeTranslations({
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
        const cachedTranslation = translations[normalizedSource] || getCachedRuntimeTranslation({
            language,
            text: normalizedSource,
        });

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
