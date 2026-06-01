import arMessages from './messages/compiled/ar.json';
import bnMessages from './messages/compiled/bn.json';
import enMessages from './messages/compiled/en.json';
import enXaMessages from './messages/compiled/en-XA.json';
import hiMessages from './messages/compiled/hi.json';
import urMessages from './messages/compiled/ur.json';

export const catalogs = {
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
