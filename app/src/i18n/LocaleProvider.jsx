import { createContext, useContext, useMemo } from 'react';
import { IntlProvider } from 'react-intl';
import { useMarket } from '@/context/MarketContext';
import { catalogs, isFormatJsEnabled, resolveFormatJsLanguage } from './catalogs';

const LocaleContext = createContext(null);
export { isFormatJsEnabled, resolveFormatJsLanguage };

export function LocaleProvider({ children }) {
    const market = useMarket();
    const language = resolveFormatJsLanguage(market.languageCode);
    const locale = language === 'en-XA' ? 'en-US' : market.locale;
    const messages = catalogs[language] || catalogs.en;
    const value = useMemo(() => ({
        direction: market.direction,
        language,
        locale,
        messages,
    }), [language, locale, market.direction, messages]);

    return (
        <LocaleContext.Provider value={value}>
            <IntlProvider
                defaultLocale="en"
                locale={locale}
                messages={messages}
                onError={(error) => {
                    if (import.meta.env.DEV) {
                        console.warn('i18n.formatjs_error', error);
                    }
                }}
            >
                {children}
            </IntlProvider>
        </LocaleContext.Provider>
    );
}

export function useLocale() {
    const context = useContext(LocaleContext);
    if (!context) {
        throw new Error('useLocale must be used inside LocaleProvider');
    }
    return context;
}
