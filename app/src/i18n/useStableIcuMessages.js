import { useCallback, useMemo } from 'react';
import { createIntl, createIntlCache } from 'react-intl';
import { useOptionalMarket } from '@/context/MarketContext';
import { catalogs, resolveFormatJsLanguage } from './catalogs';
import { useOptionalLocale } from './LocaleProvider';

const intlCache = createIntlCache();

const interpolateFallbackTemplate = (template = '', values = {}) => String(template || '')
    .replace(/\{\{\s*([^}\s]+)\s*\}\}|\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, doubleToken, singleToken) => {
        const key = doubleToken || singleToken;
        return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : '';
    });

export const useStableIcuMessages = (legacyTranslate) => {
    const market = useOptionalMarket();
    const localeContext = useOptionalLocale();
    const language = localeContext?.language || resolveFormatJsLanguage(market?.languageCode || 'en');
    const locale = localeContext?.locale || (language === 'en-XA' ? 'en-US' : market?.locale || 'en-US');
    const messages = localeContext?.messages || catalogs[language] || catalogs.en;
    const intl = useMemo(() => createIntl({
        defaultLocale: 'en',
        locale,
        messages,
        onError: () => {},
    }, intlCache), [locale, messages]);
    const translateFallback = useCallback((id, values = {}, fallback = '') => {
        if (typeof legacyTranslate === 'function') {
            return legacyTranslate(id, values, fallback);
        }
        const template = fallback || catalogs.en[id] || '';
        return template ? interpolateFallbackTemplate(template, values) : id;
    }, [legacyTranslate]);

    return useCallback((id, values = {}, fallback = '') => {
        const defaultMessage = catalogs.en[id];
        if (!defaultMessage) {
            return translateFallback(id, values, fallback);
        }

        try {
            const localizedTemplate = messages[id];
            // Wait for lazy locale catalog or fall back to legacy pack if the catalog entry still copies English verbatim.
            if (
                language !== 'en'
                && (!localizedTemplate || localizedTemplate === defaultMessage)
                && typeof legacyTranslate === 'function'
            ) {
                const legacyCandidate = legacyTranslate(id, values, defaultMessage);
                if (legacyCandidate && legacyCandidate !== defaultMessage && legacyCandidate !== id) {
                    return legacyCandidate;
                }
            }

            // Extraction comes from stableUiMessages.js; this adapter formats catalog-backed IDs at runtime.
            return intl['formatMessage']({ id, defaultMessage }, values);
        } catch {
            return translateFallback(id, values, fallback || defaultMessage);
        }
    }, [intl, language, legacyTranslate, messages, translateFallback]);
};
