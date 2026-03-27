import { apiFetch } from '../apiBase';

const FX_CACHE_TTL_MS = 30 * 60 * 1000;
const FX_STORAGE_KEY_PREFIX = 'aura_market_fx_rates_v1';
const fxPayloadCache = new Map();
const inflightFxRequests = new Map();

const normalizeCurrencyCode = (value = '', fallback = 'INR') => (
    String(value || fallback).trim().toUpperCase() || fallback
);

const getCacheKey = (baseCurrency = 'INR') => normalizeCurrencyCode(baseCurrency);

const isFresh = (cachedAt = 0) => (Date.now() - Number(cachedAt || 0)) < FX_CACHE_TTL_MS;

const normalizeRates = (rates = {}, baseCurrency = 'INR') => {
    const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency);
    const normalizedRates = Object.entries(rates || {}).reduce((result, [currency, rate]) => {
        const normalizedCurrency = normalizeCurrencyCode(currency, '');
        const numericRate = Number(rate);
        if (normalizedCurrency && Number.isFinite(numericRate) && numericRate > 0) {
            result[normalizedCurrency] = numericRate;
        }
        return result;
    }, {});

    normalizedRates[normalizedBaseCurrency] = 1;
    return normalizedRates;
};

const readSessionPayload = (baseCurrency = 'INR') => {
    if (typeof window === 'undefined') {
        return null;
    }

    try {
        const rawValue = window.sessionStorage.getItem(`${FX_STORAGE_KEY_PREFIX}:${getCacheKey(baseCurrency)}`);
        if (!rawValue) {
            return null;
        }

        const parsed = JSON.parse(rawValue);
        if (!isFresh(parsed.cachedAt)) {
            window.sessionStorage.removeItem(`${FX_STORAGE_KEY_PREFIX}:${getCacheKey(baseCurrency)}`);
            return null;
        }

        return {
            ...parsed,
            baseCurrency: normalizeCurrencyCode(parsed.baseCurrency || baseCurrency),
            rates: normalizeRates(parsed.rates, parsed.baseCurrency || baseCurrency),
        };
    } catch {
        return null;
    }
};

const writeSessionPayload = (payload = {}) => {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.sessionStorage.setItem(
            `${FX_STORAGE_KEY_PREFIX}:${getCacheKey(payload.baseCurrency)}`,
            JSON.stringify(payload),
        );
    } catch {
        // Ignore session storage failures and keep the in-memory cache.
    }
};

const readCachedPayload = (baseCurrency = 'INR') => {
    const cacheKey = getCacheKey(baseCurrency);
    const memoryCached = fxPayloadCache.get(cacheKey);
    if (memoryCached && isFresh(memoryCached.cachedAt)) {
        return memoryCached.value;
    }

    const sessionCached = readSessionPayload(cacheKey);
    if (sessionCached) {
        fxPayloadCache.set(cacheKey, {
            value: sessionCached,
            cachedAt: Number(sessionCached.cachedAt || Date.now()),
        });
        return sessionCached;
    }

    return null;
};

const writeCachedPayload = (payload = {}) => {
    const normalizedPayload = {
        ...payload,
        baseCurrency: normalizeCurrencyCode(payload.baseCurrency),
        rates: normalizeRates(payload.rates, payload.baseCurrency),
        cachedAt: Date.now(),
    };

    const cacheKey = getCacheKey(normalizedPayload.baseCurrency);
    fxPayloadCache.set(cacheKey, {
        value: normalizedPayload,
        cachedAt: normalizedPayload.cachedAt,
    });
    writeSessionPayload(normalizedPayload);
    return normalizedPayload;
};

export const readCachedBrowseFxRates = (baseCurrency = 'INR') => readCachedPayload(baseCurrency);

export const clearMarketApiCache = () => {
    fxPayloadCache.clear();
    inflightFxRequests.clear();
};

export const marketApi = {
    getBrowseFxRates: async ({
        baseCurrency = 'INR',
        signal,
        force = false,
    } = {}) => {
        const normalizedBaseCurrency = normalizeCurrencyCode(baseCurrency);
        const cacheKey = getCacheKey(normalizedBaseCurrency);

        if (!force) {
            const cached = readCachedPayload(normalizedBaseCurrency);
            if (cached) {
                return cached;
            }

            const inflight = inflightFxRequests.get(cacheKey);
            if (inflight) {
                return inflight;
            }
        }

        const request = apiFetch('/markets/fx-rates', {
            method: 'GET',
            params: {
                baseCurrency: normalizedBaseCurrency,
            },
            signal,
            timeoutMs: 12000,
            retries: 1,
        })
            .then(({ data }) => writeCachedPayload({
                baseCurrency: data?.baseCurrency || normalizedBaseCurrency,
                rates: data?.rates || {},
                source: data?.source || '',
                provider: data?.provider || '',
                fetchedAt: data?.fetchedAt || '',
                asOfDate: data?.asOfDate || '',
                stale: Boolean(data?.stale),
                staleReason: data?.staleReason || '',
            }))
            .finally(() => {
                if (inflightFxRequests.get(cacheKey) === request) {
                    inflightFxRequests.delete(cacheKey);
                }
            });

        inflightFxRequests.set(cacheKey, request);
        return request;
    },
};
