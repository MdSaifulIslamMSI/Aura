import { createContext, useContext, useMemo } from 'react';
import { IntlProvider } from 'react-intl';
import { useMarket } from '@/context/MarketContext';
import arMessages from './messages/compiled/ar.json';
import bnMessages from './messages/compiled/bn.json';
import enMessages from './messages/compiled/en.json';
import enXaMessages from './messages/compiled/en-XA.json';
import hiMessages from './messages/compiled/hi.json';
import urMessages from './messages/compiled/ur.json';

const LocaleContext = createContext(null);
const catalogs = {
    ar: arMessages,
    bn: bnMessages,
    en: enMessages,
    'en-XA': enXaMessages,
    hi: hiMessages,
    ur: urMessages,
};

const parseBooleanEnv = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

export const isFormatJsEnabled = () => parseBooleanEnv(
    import.meta.env.VITE_I18N_FORMATJS_ENABLED,
    false
);

export const resolveFormatJsLanguage = (language = 'en') => (
    isFormatJsEnabled() && catalogs[language] ? language : 'en'
);

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
