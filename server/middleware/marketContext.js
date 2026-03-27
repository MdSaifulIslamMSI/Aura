const {
    DEFAULT_COUNTRY_CODE,
    DEFAULT_CURRENCY,
    DEFAULT_LANGUAGE_CODE,
    normalizeCountryCode,
    normalizeCurrencyCode,
    normalizeLanguageCode,
    parseAcceptLanguage,
    resolveMarketContext,
} = require('../services/markets/marketCatalog');

const readMarketValue = (value) => {
    if (value === undefined || value === null) return '';
    return String(Array.isArray(value) ? value[0] : value).trim();
};

const extractBodyMarket = (req = {}) => {
    const bodyMarket = req?.body?.paymentContext?.market || req?.body?.market || {};
    return {
        country: readMarketValue(bodyMarket.countryCode || bodyMarket.country),
        currency: readMarketValue(bodyMarket.currency),
        language: readMarketValue(bodyMarket.language),
    };
};

const resolveMarketContextMiddleware = (req, res, next) => {
    const headerCountry = normalizeCountryCode(req.headers['x-market-country']);
    const headerCurrency = normalizeCurrencyCode(req.headers['x-market-currency']);
    const headerLanguage = normalizeLanguageCode(req.headers['x-market-language']);

    const queryCountry = normalizeCountryCode(req.query?.market || req.query?.country || '');
    const queryCurrency = normalizeCurrencyCode(req.query?.currency || '');
    const queryLanguage = normalizeLanguageCode(req.query?.language || '');

    const bodyMarket = extractBodyMarket(req);
    const bodyCountry = normalizeCountryCode(bodyMarket.country);
    const bodyCurrency = normalizeCurrencyCode(bodyMarket.currency);
    const bodyLanguage = normalizeLanguageCode(bodyMarket.language);

    const market = resolveMarketContext({
        country: headerCountry || queryCountry || bodyCountry || DEFAULT_COUNTRY_CODE,
        currency: headerCurrency || queryCurrency || bodyCurrency || DEFAULT_CURRENCY,
        language: headerLanguage || queryLanguage || bodyLanguage || parseAcceptLanguage(req.headers['accept-language']) || DEFAULT_LANGUAGE_CODE,
        acceptLanguage: req.headers['accept-language'],
        source: headerCountry || headerCurrency || headerLanguage
            ? 'headers'
            : queryCountry || queryCurrency || queryLanguage
                ? 'query'
                : bodyCountry || bodyCurrency || bodyLanguage
                    ? 'body'
                    : 'default',
    });

    req.market = market;
    res.locals.market = market;
    res.setHeader('x-market-country', market.countryCode);
    res.setHeader('x-market-currency', market.currency);
    res.setHeader('x-market-language', market.language);
    next();
};

module.exports = {
    resolveMarketContextMiddleware,
};
