const AppError = require('../../utils/AppError');
const { getFxQuote } = require('../payments/fxRateService');
const { roundCurrency } = require('../payments/helpers');
const {
    DEFAULT_BASE_CURRENCY,
    ensureMarketAccess,
    normalizeCurrencyCode,
} = require('./marketCatalog');

const FALLBACK_PRICING_MESSAGE = 'Final price will be calculated at checkout';

const isFiniteAmount = (value) => Number.isFinite(Number(value));

const formatCurrency = ({ amount = 0, currency = DEFAULT_BASE_CURRENCY, locale = 'en-US' } = {}) => {
    const safeAmount = Number(amount || 0);
    const safeCurrency = normalizeCurrencyCode(currency) || DEFAULT_BASE_CURRENCY;

    try {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: safeCurrency,
            maximumFractionDigits: safeCurrency === 'JPY' ? 0 : 2,
        }).format(safeAmount);
    } catch {
        return `${safeCurrency} ${safeAmount.toFixed(safeCurrency === 'JPY' ? 0 : 2)}`;
    }
};

const toLockedFxMetadata = (fxQuote = null) => {
    if (!fxQuote) return null;

    return {
        rate: Number(fxQuote.rate || 0),
        timestamp: fxQuote.quotedAt || fxQuote.asOfDate || new Date().toISOString(),
        provider: fxQuote.provider || '',
        source: fxQuote.source || '',
        stale: Boolean(fxQuote.stale),
        staleReason: fxQuote.staleReason || '',
        asOfDate: fxQuote.asOfDate || '',
    };
};

const buildFallbackPrice = ({
    baseAmount = 0,
    baseCurrency = DEFAULT_BASE_CURRENCY,
    market,
    message = FALLBACK_PRICING_MESSAGE,
} = {}) => {
    const activeMarket = ensureMarketAccess(market);
    const safeBaseCurrency = normalizeCurrencyCode(baseCurrency) || DEFAULT_BASE_CURRENCY;
    const roundedBaseAmount = roundCurrency(baseAmount, safeBaseCurrency);

    return {
        baseAmount: roundedBaseAmount,
        baseCurrency: safeBaseCurrency,
        displayAmount: roundedBaseAmount,
        displayCurrency: safeBaseCurrency,
        fxRateLocked: safeBaseCurrency === safeBaseCurrency ? 1 : null,
        fxTimestamp: new Date().toISOString(),
        formattedPrice: formatCurrency({
            amount: roundedBaseAmount,
            currency: safeBaseCurrency,
            locale: activeMarket.locale,
        }),
        fallbackMessage: message,
        fallbackApplied: true,
        requestedDisplayCurrency: activeMarket.currency,
        providerFx: null,
    };
};

const buildLockedPrice = async ({
    baseAmount = 0,
    baseCurrency = DEFAULT_BASE_CURRENCY,
    market,
    allowFallback = true,
    fallbackMessage = FALLBACK_PRICING_MESSAGE,
} = {}) => {
    const activeMarket = ensureMarketAccess(market);
    const safeBaseCurrency = normalizeCurrencyCode(baseCurrency) || DEFAULT_BASE_CURRENCY;
    const requestedDisplayCurrency = normalizeCurrencyCode(activeMarket.currency) || safeBaseCurrency;
    const roundedBaseAmount = roundCurrency(baseAmount, safeBaseCurrency);

    if (!isFiniteAmount(roundedBaseAmount) || roundedBaseAmount < 0) {
        throw new AppError('Invalid base amount for market pricing', 500);
    }

    if (requestedDisplayCurrency === safeBaseCurrency) {
        return {
            baseAmount: roundedBaseAmount,
            baseCurrency: safeBaseCurrency,
            displayAmount: roundedBaseAmount,
            displayCurrency: requestedDisplayCurrency,
            fxRateLocked: 1,
            fxTimestamp: new Date().toISOString(),
            formattedPrice: formatCurrency({
                amount: roundedBaseAmount,
                currency: requestedDisplayCurrency,
                locale: activeMarket.locale,
            }),
            fallbackMessage: '',
            fallbackApplied: false,
            requestedDisplayCurrency,
            providerFx: null,
        };
    }

    try {
        const fxQuote = await getFxQuote({
            baseCurrency: safeBaseCurrency,
            targetCurrency: requestedDisplayCurrency,
            amount: roundedBaseAmount,
        });
        const displayAmount = roundCurrency(fxQuote.amount, requestedDisplayCurrency);

        return {
            baseAmount: roundedBaseAmount,
            baseCurrency: safeBaseCurrency,
            displayAmount,
            displayCurrency: requestedDisplayCurrency,
            fxRateLocked: Number(fxQuote.rate || 0),
            fxTimestamp: fxQuote.quotedAt || fxQuote.asOfDate || new Date().toISOString(),
            formattedPrice: formatCurrency({
                amount: displayAmount,
                currency: requestedDisplayCurrency,
                locale: activeMarket.locale,
            }),
            fallbackMessage: '',
            fallbackApplied: false,
            requestedDisplayCurrency,
            providerFx: toLockedFxMetadata(fxQuote),
        };
    } catch (error) {
        if (!allowFallback) {
            throw error;
        }

        return buildFallbackPrice({
            baseAmount: roundedBaseAmount,
            baseCurrency: safeBaseCurrency,
            market: activeMarket,
            message: fallbackMessage,
        });
    }
};

const buildDisplayPair = async ({
    amount = 0,
    originalAmount = 0,
    baseCurrency = DEFAULT_BASE_CURRENCY,
    market,
    allowFallback = true,
    fallbackMessage = FALLBACK_PRICING_MESSAGE,
} = {}) => {
    const current = await buildLockedPrice({
        baseAmount: amount,
        baseCurrency,
        market,
        allowFallback,
        fallbackMessage,
    });

    const safeOriginalAmount = Number(originalAmount || 0);
    if (!Number.isFinite(safeOriginalAmount) || safeOriginalAmount <= Number(amount || 0)) {
        return {
            ...current,
            originalBaseAmount: roundCurrency(amount, baseCurrency),
            originalDisplayAmount: current.displayAmount,
            formattedOriginalPrice: current.formattedPrice,
        };
    }

    const original = await buildLockedPrice({
        baseAmount: originalAmount,
        baseCurrency,
        market,
        allowFallback,
        fallbackMessage,
    });

    return {
        ...current,
        originalBaseAmount: original.baseAmount,
        originalDisplayAmount: original.displayAmount,
        formattedOriginalPrice: original.formattedPrice,
    };
};

const convertDisplayAmountToBaseAmount = async ({
    amount = 0,
    displayCurrency = DEFAULT_BASE_CURRENCY,
    baseCurrency = DEFAULT_BASE_CURRENCY,
    allowFallback = true,
} = {}) => {
    const safeAmount = Number(amount || 0);
    const safeDisplayCurrency = normalizeCurrencyCode(displayCurrency) || baseCurrency;
    const safeBaseCurrency = normalizeCurrencyCode(baseCurrency) || DEFAULT_BASE_CURRENCY;

    if (!Number.isFinite(safeAmount) || safeAmount < 0) {
        return 0;
    }

    if (safeDisplayCurrency === safeBaseCurrency) {
        return roundCurrency(safeAmount, safeBaseCurrency);
    }

    try {
        const fxQuote = await getFxQuote({
            baseCurrency: safeDisplayCurrency,
            targetCurrency: safeBaseCurrency,
            amount: safeAmount,
        });
        return roundCurrency(fxQuote.amount, safeBaseCurrency);
    } catch (error) {
        if (!allowFallback) {
            throw error;
        }
        return roundCurrency(safeAmount, safeBaseCurrency);
    }
};

module.exports = {
    FALLBACK_PRICING_MESSAGE,
    formatCurrency,
    buildLockedPrice,
    buildDisplayPair,
    convertDisplayAmountToBaseAmount,
};
