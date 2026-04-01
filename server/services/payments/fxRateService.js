const Decimal = require('decimal.js');
const AppError = require('../../utils/AppError');
const {
    normalizeCurrencyCode,
    roundCurrency,
} = require('./helpers');

const OPEN_EXCHANGE_RATES_LATEST_URL = process.env.PAYMENT_FX_OPEN_EXCHANGE_RATES_URL
    || 'https://openexchangerates.org/api/latest.json';
const ECB_DAILY_RATES_URL = process.env.PAYMENT_FX_ECB_DAILY_URL
    || 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const DEFAULT_ECB_TTL_MS = 60 * 60 * 1000;
const DEFAULT_REALTIME_TTL_MS = 60 * 60 * 1000;
const AED_PER_USD = 3.6725;

let fxCache = {
    data: null,
    expiresAt: 0,
    inFlight: null,
};

const applyDerivedRates = (rates = {}) => {
    const nextRates = { ...(rates || {}) };
    const usdRate = Number(nextRates.USD);
    const aedRate = Number(nextRates.AED);

    // ECB does not publish AED directly, so derive it from the USD peg.
    if ((!Number.isFinite(aedRate) || aedRate <= 0) && Number.isFinite(usdRate) && usdRate > 0) {
        nextRates.AED = Number(new Decimal(usdRate).times(AED_PER_USD).toSignificantDigits(12).toString());
    }

    return nextRates;
};

const normalizeProviderName = (value = '') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return 'auto';
    if (['oxr', 'openexchangerates', 'open_exchange_rates'].includes(normalized)) {
        return 'openexchangerates';
    }
    if (normalized === 'ecb') {
        return 'ecb';
    }
    return 'auto';
};

const parseTtlMs = (fallbackTtlMs = DEFAULT_ECB_TTL_MS) => {
    const raw = Number.parseInt(String(process.env.PAYMENT_FX_RATES_TTL_MS || ''), 10);
    if (!Number.isFinite(raw) || raw < 1_000) return fallbackTtlMs;
    return Math.min(raw, 24 * 60 * 60 * 1000);
};

const withCacheMetadata = (payload = {}, ttlMs = DEFAULT_ECB_TTL_MS) => ({
    ...payload,
    cacheTtlMs: ttlMs,
});

const extractEcbRates = (xml = '') => {
    const asOfMatch = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/i);
    const rateMatches = Array.from(
        xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/gi)
    );

    if (!rateMatches.length) {
        throw new AppError('ECB FX feed did not return any rates', 502);
    }

    const rates = {
        EUR: 1,
    };
    rateMatches.forEach((match) => {
        rates[match[1]] = Number(match[2]);
    });

    return withCacheMetadata({
        source: 'ecb_reference_rates',
        provider: 'ecb',
        referenceBaseCurrency: 'EUR',
        asOfDate: asOfMatch?.[1] || '',
        fetchedAt: new Date().toISOString(),
        rates: applyDerivedRates(rates),
    }, parseTtlMs(DEFAULT_ECB_TTL_MS));
};

const fetchEcbRates = async () => {
    let response;
    try {
        response = await fetch(ECB_DAILY_RATES_URL, {
            headers: {
                Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1',
            },
        });
    } catch (error) {
        throw new AppError(`Unable to reach the live FX source: ${error.message}`, 502);
    }

    if (!response.ok) {
        throw new AppError(`Live FX source returned ${response.status}`, 502);
    }

    const xml = await response.text();
    return extractEcbRates(xml);
};

const extractOpenExchangeRates = (payload = {}) => {
    const timestampSeconds = Number(payload?.timestamp || 0);
    const fetchedAt = Number.isFinite(timestampSeconds) && timestampSeconds > 0
        ? new Date(timestampSeconds * 1000).toISOString()
        : new Date().toISOString();
    const baseCurrency = normalizeCurrencyCode(payload?.base) || 'USD';
    const rawRates = {
        [baseCurrency]: 1,
        ...(payload?.rates || {}),
    };
    const rates = Object.entries(rawRates).reduce((result, [currency, rate]) => {
        const normalizedCurrency = normalizeCurrencyCode(currency);
        const numericRate = Number(rate);
        if (normalizedCurrency && Number.isFinite(numericRate) && numericRate > 0) {
            result[normalizedCurrency] = numericRate;
        }
        return result;
    }, {});

    if (!Object.keys(rates).length) {
        throw new AppError('Open Exchange Rates did not return any rates', 502);
    }

    return withCacheMetadata({
        source: 'open_exchange_rates_latest',
        provider: 'openexchangerates',
        referenceBaseCurrency: baseCurrency,
        asOfDate: fetchedAt.slice(0, 10),
        fetchedAt,
        rates: applyDerivedRates(rates),
    }, parseTtlMs(DEFAULT_REALTIME_TTL_MS));
};

const fetchOpenExchangeRates = async () => {
    const appId = String(process.env.OPEN_EXCHANGE_RATES_APP_ID || '').trim();
    if (!appId) {
        throw new AppError('Open Exchange Rates App ID is not configured', 502);
    }

    const requestUrl = new URL(OPEN_EXCHANGE_RATES_LATEST_URL);
    requestUrl.searchParams.set('app_id', appId);
    requestUrl.searchParams.set('prettyprint', '0');

    let response;
    try {
        response = await fetch(requestUrl, {
            headers: {
                Accept: 'application/json',
            },
        });
    } catch (error) {
        throw new AppError(`Unable to reach Open Exchange Rates: ${error.message}`, 502);
    }

    if (!response.ok) {
        let errorBody = '';
        try {
            errorBody = await response.text();
        } catch {
            errorBody = '';
        }
        throw new AppError(`Open Exchange Rates returned ${response.status}${errorBody ? ` ${errorBody}` : ''}`, 502);
    }

    let payload;
    try {
        payload = await response.json();
    } catch (error) {
        throw new AppError(`Open Exchange Rates returned invalid JSON: ${error.message}`, 502);
    }

    return extractOpenExchangeRates(payload);
};

const getProviderSequence = () => {
    const configuredProvider = normalizeProviderName(process.env.PAYMENT_FX_PROVIDER);
    if (configuredProvider === 'openexchangerates') {
        return ['openexchangerates', 'ecb'];
    }
    if (configuredProvider === 'ecb') {
        return ['ecb'];
    }
    return String(process.env.OPEN_EXCHANGE_RATES_APP_ID || '').trim()
        ? ['openexchangerates', 'ecb']
        : ['ecb'];
};

const fetchRatesFromProvider = async (provider = 'ecb') => {
    if (provider === 'openexchangerates') {
        return fetchOpenExchangeRates();
    }
    return fetchEcbRates();
};

const fetchProviderChain = async () => {
    const providers = getProviderSequence();
    const providerErrors = [];

    for (const provider of providers) {
        try {
            return await fetchRatesFromProvider(provider);
        } catch (error) {
            providerErrors.push(`${provider}: ${error.message}`);
        }
    }

    throw new AppError(
        providerErrors.length > 0
            ? `Unable to fetch FX rates from any provider (${providerErrors.join(' | ')})`
            : 'Unable to fetch FX rates from any provider',
        502,
    );
};

const getFxRates = async ({ forceRefresh = false } = {}) => {
    const now = Date.now();

    if (!forceRefresh && fxCache.data && fxCache.expiresAt > now) {
        return fxCache.data;
    }

    if (!forceRefresh && fxCache.inFlight) {
        return fxCache.inFlight;
    }

    fxCache.inFlight = (async () => {
        try {
            const data = await fetchProviderChain();
            fxCache = {
                data,
                expiresAt: Date.now() + Number(data?.cacheTtlMs || parseTtlMs()),
                inFlight: null,
            };
            return data;
        } catch (error) {
            if (fxCache.data && fxCache.expiresAt > now) {
                return {
                    ...fxCache.data,
                    stale: true,
                    staleReason: error.message || 'fx_source_unavailable',
                };
            }
            throw error;
        } finally {
            fxCache.inFlight = null;
        }
    })();

    return fxCache.inFlight;
};

const assertRateAvailable = ({ rates, currency }) => {
    const normalized = normalizeCurrencyCode(currency);
    const rate = Number(rates?.[normalized]);
    if (!Number.isFinite(rate) || rate <= 0) {
        throw new AppError(`Live FX rate is unavailable for ${normalized}`, 409);
    }
    return rate;
};

const getFxQuote = async ({
    baseCurrency,
    targetCurrency,
    amount,
    forceRefresh = false,
} = {}) => {
    const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency);
    const normalizedTargetCurrency = normalizeCurrencyCode(targetCurrency);
    const normalizedAmount = Number(amount || 0);

    if (!Number.isFinite(normalizedAmount) || normalizedAmount < 0) {
        throw new AppError('FX quote amount must be a valid positive number', 400);
    }

    if (normalizedBaseCurrency === normalizedTargetCurrency) {
        return {
            source: 'identity',
            provider: 'none',
            baseCurrency: normalizedBaseCurrency,
            targetCurrency: normalizedTargetCurrency,
            rate: 1,
            amount: roundCurrency(normalizedAmount, normalizedTargetCurrency),
            quotedAt: new Date().toISOString(),
            asOfDate: '',
            stale: false,
        };
    }

    const ratesPayload = await getFxRates({ forceRefresh });
    const baseRate = assertRateAvailable({
        rates: ratesPayload.rates,
        currency: normalizedBaseCurrency,
    });
    const targetRate = assertRateAvailable({
        rates: ratesPayload.rates,
        currency: normalizedTargetCurrency,
    });

    const rate = new Decimal(targetRate).div(baseRate);
    const quotedAmount = roundCurrency(
        new Decimal(normalizedAmount).times(rate).toNumber(),
        normalizedTargetCurrency
    );

    return {
        source: ratesPayload.source,
        provider: ratesPayload.provider,
        referenceBaseCurrency: ratesPayload.referenceBaseCurrency,
        baseCurrency: normalizedBaseCurrency,
        targetCurrency: normalizedTargetCurrency,
        rate: Number(rate.toSignificantDigits(12).toString()),
        amount: quotedAmount,
        quotedAt: ratesPayload.fetchedAt || new Date().toISOString(),
        asOfDate: ratesPayload.asOfDate || '',
        stale: Boolean(ratesPayload.stale),
        staleReason: ratesPayload.staleReason || '',
    };
};

module.exports = {
    getFxRates,
    getFxQuote,
};
