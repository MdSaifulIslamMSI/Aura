import { useCallback, useMemo } from 'react';
import { createIntl, createIntlCache } from 'react-intl';
import { useMarket } from '@/context/MarketContext';
import { catalogs, resolveFormatJsLanguage } from './catalogs';
import { stableUiMessages } from './messages/stableUiMessages';

const intlCache = createIntlCache();

export const useStableIcuMessages = (legacyTranslate) => {
    const market = useMarket();
    const language = resolveFormatJsLanguage(market.languageCode);
    const locale = language === 'en-XA' ? 'en-US' : market.locale;
    const messages = catalogs[language] || catalogs.en;
    const intl = useMemo(() => createIntl({
        defaultLocale: 'en',
        locale,
        messages,
        onError: () => {},
    }, intlCache), [locale, messages]);

    return useCallback((id, values = {}, fallback = '') => {
        const descriptor = stableUiMessages[id];
        if (!descriptor) {
            return legacyTranslate(id, values, fallback);
        }

        try {
            return intl.formatMessage(descriptor, values);
        } catch {
            return legacyTranslate(id, values, fallback || descriptor.defaultMessage);
        }
    }, [intl, legacyTranslate]);
};
