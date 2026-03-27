const Decimal = require('decimal.js');
const AppError = require('../../utils/AppError');
const {
    normalizeCurrencyCode,
    roundCurrency,
} = require('./helpers');

const ECB_DAILY_RATES_URL = process.env.PAYMENT_FX_ECB_DAILY_URL
    || 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

let fxCache = {
    data: null,
    expiresAt: 0,
    inFlight: null,
};

const parseTtlMs = () => {
    const raw = Number.parseInt(String(process.env.PAYMENT_FX_RATES_TTL_MS || ''), 10);
    if (!Number.isFinite(raw) || raw < 60_000) return DEFAULT_TTL_MS;
    return Math.min(raw, 24 * 60 * 60 * 1000);
};

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

    return {
        source: 'ecb_reference_rates',
        provider: 'ecb',
        referenceBaseCurrency: 'EUR',
        asOfDate: asOfMatch?.[1] || '',
        fetchedAt: new Date().toISOString(),
        rates,
    };
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

const getFxRates = async ({ forceRefresh = false } = {}) => {
    const now = Date.now();
    const ttlMs = parseTtlMs();

    if (!forceRefresh && fxCache.data && fxCache.expiresAt > now) {
        return fxCache.data;
    }

    if (!forceRefresh && fxCache.inFlight) {
        return fxCache.inFlight;
    }

    fxCache.inFlight = (async () => {
        try {
            const data = await fetchEcbRates();
            fxCache = {
                data,
                expiresAt: Date.now() + ttlMs,
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
