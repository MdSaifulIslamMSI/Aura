import { useCallback, useMemo } from 'react';
import { createIntl, createIntlCache } from 'react-intl';
import { useMarket } from '@/context/MarketContext';
import { catalogs, resolveFormatJsLanguage } from './catalogs';
import { useOptionalLocale } from './LocaleProvider';

const intlCache = createIntlCache();

export const useStableIcuMessages = (legacyTranslate) => {
    const market = useMarket();
    const localeContext = useOptionalLocale();
    const language = localeContext?.language || resolveFormatJsLanguage(market.languageCode);
    const locale = language === 'en-XA' ? 'en-US' : market.locale;
    const messages = localeContext?.messages || catalogs[language] || catalogs.en;
    const intl = useMemo(() => createIntl({
        defaultLocale: 'en',
        locale,
        messages,
        onError: () => {},
    }, intlCache), [locale, messages]);

    return useCallback((id, values = {}, fallback = '') => {
        const defaultMessage = catalogs.en[id];
        if (!defaultMessage) {
            return legacyTranslate(id, values, fallback);
        }

        try {
            // Extraction comes from stableUiMessages.js; this adapter formats catalog-backed IDs at runtime.
            return intl['formatMessage']({ id, defaultMessage }, values);
        } catch {
            return legacyTranslate(id, values, fallback || defaultMessage);
        }
    }, [intl, legacyTranslate]);
};
