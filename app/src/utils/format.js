const formatterCache = new Map();

const getCurrencyFormatter = (currency = 'INR', locale = 'en-IN') => {
    const normalizedCurrency = String(currency || 'INR').trim().toUpperCase() || 'INR';
    const cacheKey = `${locale}:${normalizedCurrency}`;
    if (!formatterCache.has(cacheKey)) {
        formatterCache.set(cacheKey, new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: normalizedCurrency,
            maximumFractionDigits: normalizedCurrency === 'JPY' ? 0 : 2,
        }));
    }
    return formatterCache.get(cacheKey);
};

export const priceFormatter = getCurrencyFormatter('INR');

export const formatPrice = (price, currency = 'INR', locale = 'en-IN') => (
    getCurrencyFormatter(currency, locale).format(Number(price || 0))
);
