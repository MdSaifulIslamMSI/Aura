import { useCallback, useMemo } from 'react';
import { createIntl, createIntlCache } from 'react-intl';
import { useOptionalMarket } from '@/context/MarketContext';
import { catalogs, resolveFormatJsLanguage } from './catalogs';
import { useOptionalLocale } from './LocaleProvider';

const intlCache = createIntlCache();

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
        return fallback || catalogs.en[id] || id;
    }, [legacyTranslate]);

    return useCallback((id, values = {}, fallback = '') => {
        const defaultMessage = catalogs.en[id];
        if (!defaultMessage) {
            return translateFallback(id, values, fallback);
        }

        try {
            // Extraction comes from stableUiMessages.js; this adapter formats catalog-backed IDs at runtime.
            return intl['formatMessage']({ id, defaultMessage }, values);
        } catch {
            return translateFallback(id, values, fallback || defaultMessage);
        }
    }, [intl, translateFallback]);
};
