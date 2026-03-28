const formatterCache = new Map();
const numberFormatterCache = new Map();
const dateFormatterCache = new Map();
const conversionFactorCache = new WeakMap();

const marketDefaults = {
    currency: 'INR',
    locale: 'en-IN',
    baseCurrency: 'INR',
    rates: {
        INR: 1,
    },
};

const toCurrencyCode = (value, fallback = 'INR') => {
    const normalized = String(value || fallback).trim().toUpperCase();
    return normalized || fallback;
};

const toLocaleCode = (value, fallback = 'en-IN') => {
    const normalized = String(value || fallback).trim();
    return normalized || fallback;
};

const getCurrencyFormatter = (currency = 'INR', locale = 'en-IN') => {
    const normalizedCurrency = toCurrencyCode(currency);
    const normalizedLocale = toLocaleCode(locale);
    const cacheKey = `${normalizedLocale}:${normalizedCurrency}`;
    if (!formatterCache.has(cacheKey)) {
        formatterCache.set(cacheKey, new Intl.NumberFormat(normalizedLocale, {
            style: 'currency',
            currency: normalizedCurrency,
            maximumFractionDigits: normalizedCurrency === 'JPY' ? 0 : 2,
        }));
    }
    return formatterCache.get(cacheKey);
};

const getNumberFormatter = (locale = 'en-IN', options = {}) => {
    const normalizedLocale = toLocaleCode(locale);
    const cacheKey = `${normalizedLocale}:${JSON.stringify(options)}`;
    if (!numberFormatterCache.has(cacheKey)) {
        numberFormatterCache.set(cacheKey, new Intl.NumberFormat(normalizedLocale, options));
    }
    return numberFormatterCache.get(cacheKey);
};

const getDateFormatter = (locale = 'en-IN', options = {}) => {
    const normalizedLocale = toLocaleCode(locale);
    const cacheKey = `${normalizedLocale}:${JSON.stringify(options)}`;
    if (!dateFormatterCache.has(cacheKey)) {
        dateFormatterCache.set(cacheKey, new Intl.DateTimeFormat(normalizedLocale, options));
    }
    return dateFormatterCache.get(cacheKey);
};

const getCurrencyFractionDigits = (currency = 'INR') => (
    toCurrencyCode(currency) === 'JPY' ? 0 : 2
);

const roundCurrencyAmount = (amount, currency = 'INR') => {
    const digits = getCurrencyFractionDigits(currency);
    const precision = 10 ** digits;
    return Math.round((Number(amount || 0) + Number.EPSILON) * precision) / precision;
};

const resolveRate = (currency = 'INR', rates = marketDefaults.rates) => {
    const normalizedCurrency = toCurrencyCode(currency);
    const rate = Number(rates?.[normalizedCurrency] || 0);
    return Number.isFinite(rate) && rate > 0 ? rate : normalizedCurrency === marketDefaults.baseCurrency ? 1 : 0;
};

const getConversionBucket = (rates = marketDefaults.rates) => {
    const rateTable = rates && typeof rates === 'object' ? rates : marketDefaults.rates;
    let bucket = conversionFactorCache.get(rateTable);
    if (!bucket) {
        bucket = new Map();
        conversionFactorCache.set(rateTable, bucket);
    }
    return bucket;
};

const getConversionFactor = (
    fromCurrency = marketDefaults.baseCurrency,
    toCurrency = marketDefaults.currency,
    rates = marketDefaults.rates
) => {
    const normalizedFrom = toCurrencyCode(fromCurrency, marketDefaults.baseCurrency);
    const normalizedTo = toCurrencyCode(toCurrency, marketDefaults.currency);

    if (normalizedFrom === normalizedTo) {
        return 1;
    }

    const bucket = getConversionBucket(rates);
    const cacheKey = `${normalizedFrom}:${normalizedTo}:${marketDefaults.baseCurrency}`;
    if (bucket.has(cacheKey)) {
        return bucket.get(cacheKey);
    }

    const fromRate = resolveRate(normalizedFrom, rates);
    const toRate = resolveRate(normalizedTo, rates);
    if (!fromRate || !toRate) {
        return 0;
    }

    const factor = normalizedFrom === marketDefaults.baseCurrency
        ? toRate
        : normalizedTo === marketDefaults.baseCurrency
            ? 1 / fromRate
            : toRate / fromRate;

    bucket.set(cacheKey, factor);
    return factor;
};

export const setMarketFormatDefaults = ({
    currency,
    locale,
    baseCurrency,
    rates,
} = {}) => {
    marketDefaults.currency = toCurrencyCode(currency, marketDefaults.currency);
    marketDefaults.locale = toLocaleCode(locale, marketDefaults.locale);
    marketDefaults.baseCurrency = toCurrencyCode(baseCurrency, marketDefaults.baseCurrency);
    marketDefaults.rates = rates && typeof rates === 'object'
        ? Object.entries(rates).reduce((result, [key, value]) => {
            const normalizedRate = Number(value);
            if (Number.isFinite(normalizedRate) && normalizedRate > 0) {
                result[toCurrencyCode(key)] = normalizedRate;
            }
            return result;
        }, { [marketDefaults.baseCurrency]: 1 })
        : marketDefaults.rates;
    if (!marketDefaults.rates[marketDefaults.baseCurrency]) {
        marketDefaults.rates[marketDefaults.baseCurrency] = 1;
    }
};

export const getMarketFormatDefaults = () => ({
    ...marketDefaults,
    rates: { ...marketDefaults.rates },
});

export const convertAmount = (
    amount,
    fromCurrency = marketDefaults.baseCurrency,
    toCurrency = marketDefaults.currency,
    rates = marketDefaults.rates
) => {
    const numericAmount = Number(amount || 0);
    if (!Number.isFinite(numericAmount)) return 0;

    const normalizedFrom = toCurrencyCode(fromCurrency, marketDefaults.baseCurrency);
    const normalizedTo = toCurrencyCode(toCurrency, marketDefaults.currency);

    if (normalizedFrom === normalizedTo) {
        return roundCurrencyAmount(numericAmount, normalizedTo);
    }

    const factor = getConversionFactor(normalizedFrom, normalizedTo, rates);
    if (!factor) {
        return numericAmount;
    }

    return roundCurrencyAmount(numericAmount * factor, normalizedTo);
};

export const formatPrice = (price, currency, locale, options = {}) => {
    const hasExplicitCurrency = typeof currency === 'string' && currency.trim().length > 0;
    const resolvedCurrency = toCurrencyCode(
        hasExplicitCurrency ? currency : options.presentmentCurrency || marketDefaults.currency
    );
    const resolvedLocale = toLocaleCode(locale, marketDefaults.locale);
    const resolvedBaseCurrency = toCurrencyCode(options.baseCurrency, marketDefaults.baseCurrency);
    const resolvedRates = options.rates || marketDefaults.rates;
    const numericPrice = Number(price || 0);
    const presentmentAmount = hasExplicitCurrency
        ? numericPrice
        : convertAmount(numericPrice, resolvedBaseCurrency, resolvedCurrency, resolvedRates);

    return getCurrencyFormatter(resolvedCurrency, resolvedLocale).format(Number.isFinite(presentmentAmount) ? presentmentAmount : 0);
};

export const formatNumber = (value, locale = marketDefaults.locale, options = {}) => (
    getNumberFormatter(locale, options).format(Number(value || 0))
);

export const formatDateTime = (value, locale = marketDefaults.locale, options = {}) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return getDateFormatter(locale, options).format(date);
};

export const priceFormatter = {
    format: (value) => formatPrice(value),
};
