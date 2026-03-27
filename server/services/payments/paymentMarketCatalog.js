const AppError = require('../../utils/AppError');

const DEFAULT_SETTLEMENT_CURRENCY = 'INR';
const DEFAULT_DOMESTIC_COUNTRY = 'IN';
const DEFAULT_CARD_PRESENTMENT_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD', 'JPY'];

const regionNames = typeof Intl?.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;
const currencyNames = typeof Intl?.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'currency' })
    : null;

const safeUpper = (value) => String(value || '').trim().toUpperCase();

const normalizeCountryCode = (value) => {
    const code = safeUpper(value);
    return /^[A-Z]{2}$/.test(code) ? code : '';
};

const normalizeCurrencyCode = (value) => {
    const code = safeUpper(value);
    return /^[A-Z]{3}$/.test(code) ? code : '';
};

const parseEnvList = (value, normalizer, fallback = []) => {
    const raw = String(value || '').trim();
    if (!raw) return [...fallback];

    const unique = new Set();
    raw.split(',')
        .map((entry) => normalizer(entry))
        .filter(Boolean)
        .forEach((entry) => unique.add(entry));
    return Array.from(unique);
};

const getCountryName = (countryCode) => {
    const normalized = normalizeCountryCode(countryCode);
    if (!normalized) return '';
    return regionNames?.of(normalized) || normalized;
};

const getCurrencyName = (currencyCode) => {
    const normalized = normalizeCurrencyCode(currencyCode);
    if (!normalized) return '';
    return currencyNames?.of(normalized) || normalized;
};

const buildCodeNameEntries = (codes = [], getName) => (
    Array.from(new Set((codes || []).filter(Boolean)))
        .map((code) => ({
            code,
            name: getName(code) || code,
        }))
        .sort((left, right) => left.name.localeCompare(right.name, 'en'))
);

const buildCountryEntries = (codes = []) => buildCodeNameEntries(codes, getCountryName);
const buildCurrencyEntries = (codes = []) => buildCodeNameEntries(codes, getCurrencyName);

const getCardCountryMode = () => {
    const allowlist = parseEnvList(process.env.PAYMENT_CARD_ALLOWED_COUNTRIES, normalizeCountryCode);
    const blocked = parseEnvList(process.env.PAYMENT_CARD_BLOCKED_COUNTRIES, normalizeCountryCode);
    return {
        countryMode: allowlist.length > 0 ? 'allowlist' : 'global_except_blocked',
        countryCodes: allowlist,
        blockedCountryCodes: blocked,
    };
};

const getSettlementCurrency = () => (
    normalizeCurrencyCode(process.env.PAYMENT_SETTLEMENT_CURRENCY) || DEFAULT_SETTLEMENT_CURRENCY
);

const getDomesticCountryCode = () => (
    normalizeCountryCode(process.env.PAYMENT_DOMESTIC_COUNTRY_CODE) || DEFAULT_DOMESTIC_COUNTRY
);

const buildRailMarkets = ({ capabilities } = {}) => {
    const settlementCurrency = getSettlementCurrency();
    const domesticCountryCode = getDomesticCountryCode();
    const cardCurrencies = parseEnvList(
        process.env.PAYMENT_CARD_PRESENTMENT_CURRENCIES,
        normalizeCurrencyCode,
        DEFAULT_CARD_PRESENTMENT_CURRENCIES
    );
    const cardCountryConfig = getCardCountryMode();

    const domesticOnly = (available) => ({
        available: Boolean(available),
        countryMode: 'allowlist',
        countryCodes: [domesticCountryCode],
        blockedCountryCodes: [],
        countries: buildCountryEntries([domesticCountryCode]),
        currencies: buildCurrencyEntries([settlementCurrency]),
        crossBorder: false,
        settlementCurrency,
    });

    return {
        UPI: domesticOnly(capabilities?.rails?.upi?.available ?? true),
        WALLET: domesticOnly(capabilities?.rails?.wallet?.available ?? true),
        NETBANKING: domesticOnly(capabilities?.rails?.netbanking?.available ?? true),
        CARD: {
            available: Boolean(capabilities?.rails?.card?.available ?? true),
            countryMode: cardCountryConfig.countryMode,
            countryCodes: cardCountryConfig.countryCodes,
            blockedCountryCodes: cardCountryConfig.blockedCountryCodes,
            countries: buildCountryEntries(cardCountryConfig.countryCodes),
            currencies: buildCurrencyEntries(cardCurrencies),
            crossBorder: true,
            settlementCurrency,
        },
    };
};

const getPaymentMarketCatalog = ({ capabilities } = {}) => {
    const settlementCurrency = getSettlementCurrency();
    const domesticCountryCode = getDomesticCountryCode();
    const railMatrix = buildRailMarkets({ capabilities });
    const supportedCurrencies = Array.from(new Set(
        Object.values(railMatrix)
            .flatMap((entry) => (entry.currencies || []).map((currency) => currency.code))
            .filter(Boolean)
    ));

    return {
        generatedAt: new Date().toISOString(),
        defaultCountryCode: domesticCountryCode,
        defaultCountryName: getCountryName(domesticCountryCode),
        defaultCurrency: settlementCurrency,
        defaultCurrencyName: getCurrencyName(settlementCurrency),
        settlementCurrency,
        settlementCurrencyName: getCurrencyName(settlementCurrency),
        railMatrix,
        currencies: buildCurrencyEntries(supportedCurrencies),
        summary: {
            domesticRails: Object.entries(railMatrix)
                .filter(([, entry]) => !entry.crossBorder)
                .map(([rail]) => rail),
            internationalRails: Object.entries(railMatrix)
                .filter(([, entry]) => entry.crossBorder)
                .map(([rail]) => rail),
            presentmentCurrencyCount: supportedCurrencies.length,
            cardCountryMode: railMatrix.CARD.countryMode,
            blockedCardCountries: railMatrix.CARD.blockedCountryCodes.length,
        },
    };
};

const resolvePaymentMarketContext = ({
    paymentMethod,
    paymentContext = {},
    capabilities,
} = {}) => {
    const method = safeUpper(paymentMethod);
    const catalog = getPaymentMarketCatalog({ capabilities });
    const rail = catalog.railMatrix[method];
    if (!rail) {
        throw new AppError(`Unsupported payment rail for market routing: ${paymentMethod || 'unknown'}`, 400);
    }
    if (!rail.available) {
        throw new AppError(`${method} is currently unavailable from the payment provider`, 409);
    }

    const requestedCountryCode = normalizeCountryCode(paymentContext?.market?.countryCode)
        || catalog.defaultCountryCode;
    const requestedCurrency = normalizeCurrencyCode(paymentContext?.market?.currency)
        || catalog.defaultCurrency;

    const allowedCurrencies = new Set((rail.currencies || []).map((entry) => entry.code));
    if (!allowedCurrencies.has(requestedCurrency)) {
        throw new AppError(
            `${method} is not configured for ${requestedCurrency}. Allowed currencies: ${(rail.currencies || []).map((entry) => entry.code).join(', ')}`,
            409
        );
    }

    if (rail.countryMode === 'allowlist' && !rail.countryCodes.includes(requestedCountryCode)) {
        throw new AppError(
            `${method} is currently available only in ${(rail.countries || []).map((entry) => entry.name).join(', ')}`,
            409
        );
    }

    if (rail.countryMode === 'global_except_blocked' && rail.blockedCountryCodes.includes(requestedCountryCode)) {
        throw new AppError(
            `${method} is not currently enabled for ${getCountryName(requestedCountryCode) || requestedCountryCode}`,
            409
        );
    }

    return {
        catalog,
        market: {
            countryCode: requestedCountryCode,
            countryName: getCountryName(requestedCountryCode) || requestedCountryCode,
            currency: requestedCurrency,
            currencyName: getCurrencyName(requestedCurrency) || requestedCurrency,
            settlementCurrency: catalog.settlementCurrency,
            settlementCurrencyName: catalog.settlementCurrencyName,
            isInternational: (
                requestedCountryCode !== catalog.defaultCountryCode
                || requestedCurrency !== catalog.defaultCurrency
            ),
            settlementDiffersFromRequestedCurrency: requestedCurrency !== catalog.settlementCurrency,
            railAvailabilityMode: rail.countryMode,
            crossBorder: Boolean(rail.crossBorder),
        },
    };
};

module.exports = {
    getPaymentMarketCatalog,
    resolvePaymentMarketContext,
    normalizeCountryCode,
    normalizeCurrencyCode,
    getCountryName,
    getCurrencyName,
};
