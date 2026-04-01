const Decimal = require('decimal.js');
const AppError = require('../../utils/AppError');
const { getFxRates } = require('../payments/fxRateService');
const {
    DEFAULT_BASE_CURRENCY,
    MARKET_RULES,
    normalizeCurrencyCode,
} = require('./marketCatalog');

const DEFAULT_BROWSE_CURRENCIES = [...new Set([
    DEFAULT_BASE_CURRENCY,
    ...Object.values(MARKET_RULES)
        .map((rule) => normalizeCurrencyCode(rule?.currency))
        .filter(Boolean),
])];

const normalizeCurrencyList = (values = []) => {
    const normalized = [];
    const seen = new Set();

    for (const rawValue of Array.isArray(values) ? values : []) {
        const currency = normalizeCurrencyCode(rawValue);
        if (!currency || seen.has(currency)) continue;
        seen.add(currency);
        normalized.push(currency);
    }

    return normalized;
};

const readReferenceRate = (rates = {}, currency = DEFAULT_BASE_CURRENCY) => {
    const normalizedCurrency = normalizeCurrencyCode(currency) || DEFAULT_BASE_CURRENCY;
    const rate = Number(rates?.[normalizedCurrency]);
    if (!Number.isFinite(rate) || rate <= 0) {
        throw new AppError(`Live FX rate is unavailable for ${normalizedCurrency}`, 409);
    }
    return rate;
};

const buildRelativeRate = ({
    rates = {},
    baseCurrency = DEFAULT_BASE_CURRENCY,
    targetCurrency = DEFAULT_BASE_CURRENCY,
} = {}) => {
    const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency) || DEFAULT_BASE_CURRENCY;
    const normalizedTargetCurrency = normalizeCurrencyCode(targetCurrency) || normalizedBaseCurrency;

    if (normalizedBaseCurrency === normalizedTargetCurrency) {
        return 1;
    }

    const baseRate = readReferenceRate(rates, normalizedBaseCurrency);
    const targetRate = readReferenceRate(rates, normalizedTargetCurrency);
    return Number(new Decimal(targetRate).div(baseRate).toSignificantDigits(12).toString());
};

const isUnavailableRateError = (error) => (
    error instanceof AppError && Number(error.statusCode) === 409
);

const getBrowseFxPayload = async ({
    baseCurrency = DEFAULT_BASE_CURRENCY,
    currencies = DEFAULT_BROWSE_CURRENCIES,
    forceRefresh = false,
} = {}) => {
    const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency) || DEFAULT_BASE_CURRENCY;
    const normalizedCurrencies = normalizeCurrencyList([normalizedBaseCurrency, ...currencies]);
    const ratesPayload = await getFxRates({ forceRefresh });
    const unavailableCurrencies = [];

    const rateMap = normalizedCurrencies.reduce((result, currency) => {
        try {
            result[currency] = buildRelativeRate({
                rates: ratesPayload.rates,
                baseCurrency: normalizedBaseCurrency,
                targetCurrency: currency,
            });
        } catch (error) {
            if (!isUnavailableRateError(error)) {
                throw error;
            }
            unavailableCurrencies.push(currency);
        }
        return result;
    }, {});

    return {
        baseCurrency: normalizedBaseCurrency,
        currencies: normalizedCurrencies,
        rates: rateMap,
        unavailableCurrencies,
        cacheTtlMs: Number(ratesPayload.cacheTtlMs || 0),
        source: ratesPayload.source || '',
        provider: ratesPayload.provider || '',
        referenceBaseCurrency: ratesPayload.referenceBaseCurrency || '',
        fetchedAt: ratesPayload.fetchedAt || new Date().toISOString(),
        asOfDate: ratesPayload.asOfDate || '',
        stale: Boolean(ratesPayload.stale),
        staleReason: ratesPayload.staleReason || '',
    };
};

module.exports = {
    DEFAULT_BROWSE_CURRENCIES,
    getBrowseFxPayload,
};
