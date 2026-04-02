const asyncHandler = require('express-async-handler');
const {
    DEFAULT_BASE_CURRENCY,
    normalizeCurrencyCode,
} = require('../services/markets/marketCatalog');
const {
    DEFAULT_BROWSE_CURRENCIES,
    getBrowseFxPayload,
} = require('../services/markets/marketFxService');

const parseCurrencies = (value = '') => String(value || '')
    .split(',')
    .map((entry) => normalizeCurrencyCode(entry))
    .filter(Boolean);

const getBrowseFxRates = asyncHandler(async (req, res) => {
    const baseCurrency = normalizeCurrencyCode(req.query?.baseCurrency)
        || normalizeCurrencyCode(req.market?.baseCurrency)
        || DEFAULT_BASE_CURRENCY;
    const requestedCurrencies = parseCurrencies(req.query?.currencies);

    const payload = await getBrowseFxPayload({
        baseCurrency,
        currencies: requestedCurrencies.length > 0 ? requestedCurrencies : DEFAULT_BROWSE_CURRENCIES,
    });

    res.json({
        status: 'success',
        ...payload,
    });
});

module.exports = {
    getBrowseFxRates,
};
