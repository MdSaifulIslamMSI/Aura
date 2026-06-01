import enMessages from './messages/compiled/en.json';

export const catalogs = {
    en: enMessages,
};

const catalogLoaders = {
    ar: () => import('./messages/compiled/ar.json').then((module) => module.default),
    bn: () => import('./messages/compiled/bn.json').then((module) => module.default),
    en: () => Promise.resolve(enMessages),
    'en-XA': () => import('./messages/compiled/en-XA.json').then((module) => module.default),
    hi: () => import('./messages/compiled/hi.json').then((module) => module.default),
    ur: () => import('./messages/compiled/ur.json').then((module) => module.default),
};

const catalogPromises = {};

export const loadCatalog = async (language = 'en') => {
    const resolvedLanguage = catalogLoaders[language] ? language : 'en';
    if (catalogs[resolvedLanguage]) return catalogs[resolvedLanguage];

    catalogPromises[resolvedLanguage] ||= catalogLoaders[resolvedLanguage]().then((messages) => {
        catalogs[resolvedLanguage] = messages;
        return messages;
    }).catch((error) => {
        delete catalogPromises[resolvedLanguage];
        throw error;
    });

    return catalogPromises[resolvedLanguage];
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
    isFormatJsEnabled() && catalogLoaders[language] ? language : 'en'
);
