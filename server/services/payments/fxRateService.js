const cron = require('node-cron');
const Decimal = require('decimal.js');
const AppError = require('../../utils/AppError');
const logger = require('../../utils/logger');
const FxRateSnapshot = require('../../models/FxRateSnapshot');
const {
    normalizeCurrencyCode,
    roundCurrency,
} = require('./helpers');

const OPEN_EXCHANGE_RATES_LATEST_URL = process.env.PAYMENT_FX_OPEN_EXCHANGE_RATES_URL
    || 'https://openexchangerates.org/api/latest.json';
const ECB_DAILY_RATES_URL = process.env.PAYMENT_FX_ECB_DAILY_URL
    || 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

const SNAPSHOT_KEY = 'global';
const DEFAULT_ECB_TTL_MS = 60 * 60 * 1000;
const DEFAULT_REALTIME_TTL_MS = 60 * 60 * 1000;
const DEFAULT_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_REFRESH_CRON = '0 * * * *';
const DEFAULT_REFRESH_LOCK_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_HTTP_TIMEOUT_MS = 10_000;
const DEFAULT_RATE_LIMITED_CALLS_PER_DAY = 24;
const AED_PER_USD = 3.6725;
const SERVICE_INSTANCE_ID = `fx-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;

const state = {
    snapshot: null,
    hydratePromise: null,
    refreshPromise: null,
    schedulerTask: null,
};

const getHttpFetch = () => {
    if (typeof global.fetch === 'function') {
        return global.fetch.bind(global);
    }

    // eslint-disable-next-line global-require
    return require('node-fetch');
};

const parseBoolean = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
};

const parseInteger = (
    value,
    fallback,
    { min = 0, max = Number.MAX_SAFE_INTEGER, allowZero = false } = {},
) => {
    const numeric = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(numeric)) return fallback;
    if (allowZero && numeric === 0) return 0;
    if (numeric < min) return min;
    if (numeric > max) return max;
    return numeric;
};

const toDateOrNull = (value) => {
    if (!value) return null;
    const nextDate = value instanceof Date ? value : new Date(value);
    return Number.isNaN(nextDate.getTime()) ? null : nextDate;
};

const toIsoOrEmpty = (value) => {
    const asDate = toDateOrNull(value);
    return asDate ? asDate.toISOString() : '';
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getTodayUtc = () => new Date().toISOString().slice(0, 10);

const getRefreshCron = () => String(
    process.env.PAYMENT_FX_REFRESH_CRON || DEFAULT_REFRESH_CRON
).trim() || DEFAULT_REFRESH_CRON;

const getRefreshIntervalMs = () => parseInteger(
    process.env.PAYMENT_FX_REFRESH_INTERVAL_MS,
    DEFAULT_REFRESH_INTERVAL_MS,
    { min: 60_000, max: 24 * 60 * 60 * 1000 },
);

const getRefreshLockTtlMs = () => parseInteger(
    process.env.PAYMENT_FX_REFRESH_LOCK_TTL_MS,
    DEFAULT_REFRESH_LOCK_TTL_MS,
    { min: 30_000, max: 15 * 60 * 1000 },
);

const getRetryAttempts = () => parseInteger(
    process.env.PAYMENT_FX_REFRESH_RETRY_ATTEMPTS,
    DEFAULT_RETRY_ATTEMPTS,
    { min: 1, max: 5 },
);

const getRetryBaseDelayMs = () => parseInteger(
    process.env.PAYMENT_FX_REFRESH_RETRY_BASE_DELAY_MS,
    DEFAULT_RETRY_BASE_DELAY_MS,
    { min: 250, max: 30_000 },
);

const getHttpTimeoutMs = () => parseInteger(
    process.env.PAYMENT_FX_HTTP_TIMEOUT_MS,
    DEFAULT_HTTP_TIMEOUT_MS,
    { min: 1_000, max: 60_000 },
);

const isSchedulerEnabled = () => parseBoolean(process.env.PAYMENT_FX_SCHEDULER_ENABLED, true);

const isBootstrapEnabled = () => parseBoolean(process.env.PAYMENT_FX_BOOTSTRAP_ENABLED, true);

const getSchedulerTimezone = () => String(
    process.env.PAYMENT_FX_SCHEDULER_TIMEZONE || 'UTC'
).trim() || 'UTC';

const getDailyCallLimitForProvider = (provider = '') => {
    if (provider !== 'openexchangerates') {
        return 0;
    }

    const rawValue = String(
        process.env.PAYMENT_FX_MAX_CALLS_PER_DAY ?? DEFAULT_RATE_LIMITED_CALLS_PER_DAY
    ).trim();

    if (!rawValue) {
        return 0;
    }

    return parseInteger(rawValue, DEFAULT_RATE_LIMITED_CALLS_PER_DAY, {
        min: 1,
        max: 100_000,
        allowZero: true,
    });
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

const normalizeRates = (rates = {}) => Object.entries(rates || {}).reduce((result, [currency, rate]) => {
    const normalizedCurrency = normalizeCurrencyCode(currency);
    const numericRate = Number(rate);
    if (normalizedCurrency && Number.isFinite(numericRate) && numericRate > 0) {
        result[normalizedCurrency] = numericRate;
    }
    return result;
}, {});

const normalizeProviderUsageEntry = (provider = '', value = {}) => {
    const dailyLimit = getDailyCallLimitForProvider(provider);
    const windowDate = String(value?.windowDate || '').trim();
    const isCurrentWindow = windowDate === getTodayUtc();
    const callCount = isCurrentWindow ? Number(value?.callCount || 0) : 0;

    return {
        windowDate: isCurrentWindow ? windowDate : getTodayUtc(),
        callCount,
        dailyLimit,
        blockedUntil: toIsoOrEmpty(value?.blockedUntil),
    };
};

const normalizeProviderUsageMap = (value = {}) => {
    const source = value instanceof Map ? Object.fromEntries(value.entries()) : { ...(value || {}) };
    return Object.entries(source).reduce((result, [provider, entry]) => {
        result[provider] = normalizeProviderUsageEntry(provider, entry);
        return result;
    }, {});
};

const buildSnapshotState = (document = null) => {
    if (!document) return null;

    const source = typeof document.toObject === 'function' ? document.toObject() : document;
    const ratesSource = source?.rates instanceof Map
        ? Object.fromEntries(source.rates.entries())
        : source?.rates || {};

    return {
        key: source?.key || SNAPSHOT_KEY,
        provider: String(source?.provider || '').trim(),
        source: String(source?.source || '').trim(),
        referenceBaseCurrency: normalizeCurrencyCode(source?.referenceBaseCurrency || '') || '',
        asOfDate: String(source?.asOfDate || '').trim(),
        fetchedAt: toIsoOrEmpty(source?.fetchedAt),
        expiresAt: toIsoOrEmpty(source?.expiresAt),
        cacheTtlMs: parseInteger(
            source?.cacheTtlMs,
            getRefreshIntervalMs(),
            { min: 1_000, max: 24 * 60 * 60 * 1000 },
        ),
        rates: normalizeRates(ratesSource),
        lastSuccessfulRefreshAt: toIsoOrEmpty(source?.lastSuccessfulRefreshAt),
        lastAttemptAt: toIsoOrEmpty(source?.lastAttemptAt),
        lastFailureAt: toIsoOrEmpty(source?.lastFailureAt),
        lastFailureReason: String(source?.lastFailureReason || '').trim(),
        lastTrigger: String(source?.lastTrigger || '').trim(),
        refreshLockOwner: String(source?.refreshLockOwner || '').trim(),
        refreshLockExpiresAt: toIsoOrEmpty(source?.refreshLockExpiresAt),
        providerUsage: normalizeProviderUsageMap(source?.providerUsage),
        createdAt: toIsoOrEmpty(source?.createdAt),
        updatedAt: toIsoOrEmpty(source?.updatedAt),
    };
};

const buildSnapshotPersistencePayload = (snapshot = {}) => {
    const providerUsage = Object.entries(snapshot.providerUsage || {}).reduce((result, [provider, entry]) => {
        const normalizedEntry = normalizeProviderUsageEntry(provider, entry);
        result[provider] = {
            windowDate: normalizedEntry.windowDate,
            callCount: Number(normalizedEntry.callCount || 0),
            dailyLimit: Number(normalizedEntry.dailyLimit || 0),
            blockedUntil: toDateOrNull(normalizedEntry.blockedUntil),
        };
        return result;
    }, {});

    return {
        provider: snapshot.provider || '',
        source: snapshot.source || '',
        referenceBaseCurrency: snapshot.referenceBaseCurrency || '',
        asOfDate: snapshot.asOfDate || '',
        fetchedAt: toDateOrNull(snapshot.fetchedAt),
        expiresAt: toDateOrNull(snapshot.expiresAt),
        cacheTtlMs: parseInteger(
            snapshot.cacheTtlMs,
            getRefreshIntervalMs(),
            { min: 1_000, max: 24 * 60 * 60 * 1000 },
        ),
        rates: normalizeRates(snapshot.rates),
        lastSuccessfulRefreshAt: toDateOrNull(snapshot.lastSuccessfulRefreshAt),
        lastAttemptAt: toDateOrNull(snapshot.lastAttemptAt),
        lastFailureAt: toDateOrNull(snapshot.lastFailureAt),
        lastFailureReason: snapshot.lastFailureReason || '',
        lastTrigger: snapshot.lastTrigger || '',
        refreshLockOwner: snapshot.refreshLockOwner || '',
        refreshLockExpiresAt: toDateOrNull(snapshot.refreshLockExpiresAt),
        providerUsage,
    };
};

const getProviderUsage = (snapshot = null, provider = '') => normalizeProviderUsageEntry(
    provider,
    snapshot?.providerUsage?.[provider],
);

const buildRateLimitSummary = (snapshot = null) => {
    const summary = {};

    ['openexchangerates'].forEach((provider) => {
        const dailyLimit = getDailyCallLimitForProvider(provider);
        if (!dailyLimit) return;

        const usage = getProviderUsage(snapshot, provider);
        const callsUsedToday = Number(usage.callCount || 0);
        summary[provider] = {
            dailyLimit,
            callsUsedToday,
            callsRemainingToday: Math.max(dailyLimit - callsUsedToday, 0),
            blockedUntil: usage.blockedUntil || '',
        };
    });

    return summary;
};

const isSnapshotExpired = (snapshot = null) => {
    if (!snapshot?.expiresAt) return false;
    const expiresAt = toDateOrNull(snapshot.expiresAt);
    return Boolean(expiresAt && expiresAt.getTime() <= Date.now());
};

const buildFxPayload = (snapshot = null, { stale = false, staleReason = '' } = {}) => {
    if (!snapshot) return null;

    const expired = isSnapshotExpired(snapshot);
    const effectiveStale = Boolean(stale || expired);
    const nextEligibleRefreshAt = snapshot.lastSuccessfulRefreshAt
        ? new Date(new Date(snapshot.lastSuccessfulRefreshAt).getTime() + getRefreshIntervalMs()).toISOString()
        : '';

    return {
        source: snapshot.source || '',
        provider: snapshot.provider || '',
        referenceBaseCurrency: snapshot.referenceBaseCurrency || '',
        asOfDate: snapshot.asOfDate || '',
        fetchedAt: snapshot.fetchedAt || '',
        expiresAt: snapshot.expiresAt || '',
        cacheTtlMs: Number(snapshot.cacheTtlMs || getRefreshIntervalMs()),
        rates: normalizeRates(snapshot.rates),
        lastSuccessfulRefreshAt: snapshot.lastSuccessfulRefreshAt || snapshot.fetchedAt || '',
        lastAttemptAt: snapshot.lastAttemptAt || '',
        lastFailureAt: snapshot.lastFailureAt || '',
        lastFailureReason: snapshot.lastFailureReason || '',
        nextEligibleRefreshAt,
        refreshIntervalMs: getRefreshIntervalMs(),
        rateLimit: buildRateLimitSummary(snapshot),
        stale: effectiveStale,
        staleReason: effectiveStale
            ? (staleReason || snapshot.lastFailureReason || 'fx_snapshot_stale')
            : '',
    };
};

const ensureSnapshotDocument = async () => {
    const document = await FxRateSnapshot.findOneAndUpdate(
        { key: SNAPSHOT_KEY },
        { $setOnInsert: { key: SNAPSHOT_KEY } },
        { new: true, upsert: true },
    );

    const snapshot = buildSnapshotState(document);
    if (snapshot) {
        state.snapshot = snapshot;
    }
    return snapshot;
};

const loadSnapshotFromStore = async ({ force = false } = {}) => {
    if (!force && state.snapshot) {
        return state.snapshot;
    }

    if (!force && state.hydratePromise) {
        return state.hydratePromise;
    }

    state.hydratePromise = (async () => {
        const maybeQuery = FxRateSnapshot.findOne({ key: SNAPSHOT_KEY });
        const document = maybeQuery && typeof maybeQuery.lean === 'function'
            ? await maybeQuery.lean()
            : await maybeQuery;
        const snapshot = buildSnapshotState(document);
        if (snapshot) {
            state.snapshot = snapshot;
        }
        return snapshot;
    })()
        .catch((error) => {
            logger.error('fx.snapshot_hydrate_failed', { error: error.message });
            throw error;
        })
        .finally(() => {
            state.hydratePromise = null;
        });

    return state.hydratePromise;
};

const persistSnapshot = async (patch = {}) => {
    const current = await loadSnapshotFromStore().catch(() => state.snapshot);
    const nextSnapshot = {
        ...(current || { key: SNAPSHOT_KEY }),
        ...patch,
        key: SNAPSHOT_KEY,
    };

    const document = await FxRateSnapshot.findOneAndUpdate(
        { key: SNAPSHOT_KEY },
        {
            $setOnInsert: { key: SNAPSHOT_KEY },
            $set: buildSnapshotPersistencePayload(nextSnapshot),
        },
        { new: true, upsert: true },
    );

    const snapshot = buildSnapshotState(document);
    if (snapshot) {
        state.snapshot = snapshot;
    }
    return snapshot;
};

const acquireRefreshLock = async () => {
    await ensureSnapshotDocument();

    const now = new Date();
    const lockExpiresAt = new Date(now.getTime() + getRefreshLockTtlMs());
    const document = await FxRateSnapshot.findOneAndUpdate(
        {
            key: SNAPSHOT_KEY,
            $or: [
                { refreshLockExpiresAt: null },
                { refreshLockExpiresAt: { $lte: now } },
                { refreshLockOwner: '' },
                { refreshLockOwner: SERVICE_INSTANCE_ID },
            ],
        },
        {
            $set: {
                refreshLockOwner: SERVICE_INSTANCE_ID,
                refreshLockExpiresAt: lockExpiresAt,
                lastAttemptAt: now,
            },
        },
        { new: true },
    );

    const snapshot = buildSnapshotState(document);
    if (snapshot) {
        state.snapshot = snapshot;
    }

    return Boolean(snapshot && snapshot.refreshLockOwner === SERVICE_INSTANCE_ID);
};

const releaseRefreshLock = async () => {
    try {
        const document = await FxRateSnapshot.findOneAndUpdate(
            {
                key: SNAPSHOT_KEY,
                refreshLockOwner: SERVICE_INSTANCE_ID,
            },
            {
                $set: {
                    refreshLockOwner: '',
                    refreshLockExpiresAt: null,
                },
            },
            { new: true },
        );

        const snapshot = buildSnapshotState(document);
        if (snapshot) {
            state.snapshot = snapshot;
        }
    } catch (error) {
        logger.warn('fx.refresh_lock_release_failed', { error: error.message });
    }
};

const parseTtlMs = (fallbackTtlMs = DEFAULT_ECB_TTL_MS) => {
    const ttlMs = parseInteger(
        process.env.PAYMENT_FX_RATES_TTL_MS,
        fallbackTtlMs,
        { min: 1_000, max: 24 * 60 * 60 * 1000 },
    );
    return ttlMs || fallbackTtlMs;
};

const applyDerivedRates = (rates = {}) => {
    const nextRates = { ...(rates || {}) };
    const usdRate = Number(nextRates.USD);
    const aedRate = Number(nextRates.AED);

    if ((!Number.isFinite(aedRate) || aedRate <= 0) && Number.isFinite(usdRate) && usdRate > 0) {
        nextRates.AED = Number(new Decimal(usdRate).times(AED_PER_USD).toSignificantDigits(12).toString());
    }

    return nextRates;
};

const withCacheMetadata = (payload = {}, ttlMs = DEFAULT_ECB_TTL_MS) => ({
    ...payload,
    cacheTtlMs: ttlMs,
});

const extractEcbRates = (xml = '') => {
    const asOfMatch = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/i);
    const rateMatches = Array.from(
        xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/gi),
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

const parseRetryAfterMs = (response) => {
    const rawValue = response?.headers?.get?.('retry-after');
    if (!rawValue) return 0;

    const numericSeconds = Number.parseInt(rawValue, 10);
    if (Number.isFinite(numericSeconds) && numericSeconds > 0) {
        return numericSeconds * 1000;
    }

    const retryDate = new Date(rawValue);
    if (Number.isNaN(retryDate.getTime())) {
        return 0;
    }

    return Math.max(retryDate.getTime() - Date.now(), 0);
};

const fetchWithTimeout = async (url, options = {}) => {
    const controller = new AbortController();
    const timeoutMs = getHttpTimeoutMs();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const httpFetch = getHttpFetch();
        return await httpFetch(url, {
            ...options,
            signal: controller.signal,
        });
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new AppError(`FX provider timed out after ${timeoutMs}ms`, 502);
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
};

const fetchEcbRates = async () => {
    let response;
    try {
        response = await fetchWithTimeout(ECB_DAILY_RATES_URL, {
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
        response = await fetchWithTimeout(requestUrl, {
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

        const error = new AppError(
            `Open Exchange Rates returned ${response.status}${errorBody ? ` ${errorBody}` : ''}`,
            502,
        );

        if (response.status === 429) {
            error.retryAfterMs = parseRetryAfterMs(response);
        }

        throw error;
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

const isProviderAllowed = (provider = '', snapshot = null) => {
    const dailyLimit = getDailyCallLimitForProvider(provider);
    if (!dailyLimit) {
        return {
            allowed: true,
            dailyLimit: 0,
            callsUsedToday: 0,
            callsRemainingToday: 0,
            blockedUntil: '',
        };
    }

    const usage = getProviderUsage(snapshot, provider);
    const blockedUntil = toDateOrNull(usage.blockedUntil);
    if (blockedUntil && blockedUntil.getTime() > Date.now()) {
        return {
            allowed: false,
            reason: 'provider_backoff_active',
            dailyLimit,
            callsUsedToday: Number(usage.callCount || 0),
            callsRemainingToday: Math.max(dailyLimit - Number(usage.callCount || 0), 0),
            blockedUntil: blockedUntil.toISOString(),
        };
    }

    const callsUsedToday = Number(usage.callCount || 0);
    if (callsUsedToday >= dailyLimit) {
        return {
            allowed: false,
            reason: 'daily_call_cap_reached',
            dailyLimit,
            callsUsedToday,
            callsRemainingToday: 0,
            blockedUntil: '',
        };
    }

    return {
        allowed: true,
        dailyLimit,
        callsUsedToday,
        callsRemainingToday: Math.max(dailyLimit - callsUsedToday, 0),
        blockedUntil: '',
    };
};

const recordProviderCallAttempt = async (provider = '', snapshot = null) => {
    const dailyLimit = getDailyCallLimitForProvider(provider);
    if (!dailyLimit) {
        return snapshot;
    }

    const usage = getProviderUsage(snapshot, provider);
    const nextUsage = {
        windowDate: getTodayUtc(),
        callCount: Number(usage.callCount || 0) + 1,
        dailyLimit,
        blockedUntil: '',
    };

    return persistSnapshot({
        lastAttemptAt: new Date().toISOString(),
        providerUsage: {
            ...(snapshot?.providerUsage || {}),
            [provider]: nextUsage,
        },
    });
};

const recordProviderBackoff = async (provider = '', snapshot = null, retryAfterMs = 0) => {
    if (!retryAfterMs) {
        return snapshot;
    }

    const usage = getProviderUsage(snapshot, provider);
    return persistSnapshot({
        providerUsage: {
            ...(snapshot?.providerUsage || {}),
            [provider]: {
                ...usage,
                blockedUntil: new Date(Date.now() + retryAfterMs).toISOString(),
            },
        },
    });
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
    let snapshot = await loadSnapshotFromStore();

    for (const provider of providers) {
        const gate = isProviderAllowed(provider, snapshot);
        if (!gate.allowed) {
            logger.warn('fx.provider_skipped', {
                provider,
                reason: gate.reason,
                dailyLimit: gate.dailyLimit,
                callsUsedToday: gate.callsUsedToday,
                blockedUntil: gate.blockedUntil || '',
            });
            providerErrors.push(`${provider}: ${gate.reason}`);
            continue;
        }

        try {
            snapshot = await recordProviderCallAttempt(provider, snapshot);
            return await fetchRatesFromProvider(provider);
        } catch (error) {
            if (error?.retryAfterMs > 0) {
                snapshot = await recordProviderBackoff(provider, snapshot, error.retryAfterMs);
            }

            providerErrors.push(`${provider}: ${error.message}`);
            logger.warn('fx.provider_attempt_failed', {
                provider,
                error: error.message,
            });
        }
    }

    throw new AppError(
        providerErrors.length > 0
            ? `Unable to fetch FX rates from any provider (${providerErrors.join(' | ')})`
            : 'Unable to fetch FX rates from any provider',
        502,
    );
};

const buildSuccessfulSnapshot = (payload = {}, trigger = 'manual') => {
    const fetchedAt = payload.fetchedAt || new Date().toISOString();
    const cacheTtlMs = Number(payload.cacheTtlMs || getRefreshIntervalMs());
    const expiresAt = new Date(new Date(fetchedAt).getTime() + cacheTtlMs).toISOString();

    return {
        provider: payload.provider || '',
        source: payload.source || '',
        referenceBaseCurrency: payload.referenceBaseCurrency || '',
        asOfDate: payload.asOfDate || '',
        fetchedAt,
        expiresAt,
        cacheTtlMs,
        rates: normalizeRates(payload.rates),
        lastSuccessfulRefreshAt: fetchedAt,
        lastAttemptAt: new Date().toISOString(),
        lastFailureAt: '',
        lastFailureReason: '',
        lastTrigger: trigger,
    };
};

const getStaleFallback = (snapshot = null, staleReason = 'fx_provider_unavailable') => {
    if (!snapshot) return null;
    return buildFxPayload(snapshot, { stale: true, staleReason });
};

const refreshFxRates = async ({ force = false, trigger = 'manual' } = {}) => {
    if (state.refreshPromise) {
        return state.refreshPromise;
    }

    state.refreshPromise = (async () => {
        const existingSnapshot = await loadSnapshotFromStore();
        const lockAcquired = await acquireRefreshLock();

        if (!lockAcquired) {
            logger.info('fx.refresh_skipped_lock_active', { trigger });
            const latestSnapshot = await loadSnapshotFromStore({ force: true });
            const fallback = latestSnapshot || existingSnapshot;
            if (fallback) {
                return buildFxPayload(fallback, { stale: isSnapshotExpired(fallback) });
            }
            throw new AppError('FX refresh is already in progress and no cached snapshot is available', 503);
        }

        try {
            const lockedSnapshot = await loadSnapshotFromStore({ force: true });
            const latestSnapshot = lockedSnapshot || existingSnapshot;

            if (!force && latestSnapshot?.lastSuccessfulRefreshAt) {
                const lastSuccessfulRefreshAt = new Date(latestSnapshot.lastSuccessfulRefreshAt).getTime();
                const minRefreshAt = lastSuccessfulRefreshAt + getRefreshIntervalMs();
                if (Number.isFinite(minRefreshAt) && minRefreshAt > Date.now()) {
                    logger.info('fx.refresh_skipped_min_interval', {
                        trigger,
                        nextEligibleRefreshAt: new Date(minRefreshAt).toISOString(),
                    });
                    return buildFxPayload(latestSnapshot, { stale: isSnapshotExpired(latestSnapshot) });
                }
            }

            let lastError = null;
            for (let attempt = 1; attempt <= getRetryAttempts(); attempt += 1) {
                try {
                    logger.info('fx.refresh_attempt_started', { trigger, attempt });
                    const fetchedPayload = await fetchProviderChain();
                    const persistedSnapshot = await persistSnapshot(buildSuccessfulSnapshot(fetchedPayload, trigger));
                    const responsePayload = buildFxPayload(persistedSnapshot, { stale: false });
                    logger.info('fx.refresh_succeeded', {
                        trigger,
                        attempt,
                        provider: responsePayload.provider,
                        fetchedAt: responsePayload.fetchedAt,
                        cacheTtlMs: responsePayload.cacheTtlMs,
                    });
                    return responsePayload;
                } catch (error) {
                    lastError = error;
                    logger.warn('fx.refresh_attempt_failed', {
                        trigger,
                        attempt,
                        error: error.message,
                    });

                    if (attempt < getRetryAttempts()) {
                        const retryDelayMs = getRetryBaseDelayMs() * (2 ** (attempt - 1));
                        await sleep(retryDelayMs);
                    }
                }
            }

            await persistSnapshot({
                lastAttemptAt: new Date().toISOString(),
                lastFailureAt: new Date().toISOString(),
                lastFailureReason: lastError?.message || 'fx_refresh_failed',
                lastTrigger: trigger,
            });

            logger.error('fx.refresh_failed', {
                trigger,
                error: lastError?.message || 'unknown_error',
            });

            const fallbackSnapshot = await loadSnapshotFromStore({ force: true });
            const fallbackPayload = getStaleFallback(
                fallbackSnapshot || existingSnapshot,
                lastError?.message || 'fx_refresh_failed',
            );
            if (fallbackPayload) {
                return fallbackPayload;
            }

            throw lastError || new AppError('Unable to refresh FX rates', 502);
        } finally {
            await releaseRefreshLock();
        }
    })().finally(() => {
        state.refreshPromise = null;
    });

    return state.refreshPromise;
};

const getFxRates = async ({ allowStale = true } = {}) => {
    const snapshot = await loadSnapshotFromStore();
    if (!snapshot) {
        throw new AppError('FX rates are not initialized yet. Run the scheduler or the refresh job first.', 503);
    }

    const expired = isSnapshotExpired(snapshot);
    if (expired && !allowStale) {
        throw new AppError('FX rates cache has expired and stale reads are disabled', 503);
    }

    return buildFxPayload(snapshot, {
        stale: expired,
        staleReason: expired ? (snapshot.lastFailureReason || 'fx_cache_expired') : '',
    });
};

const assertRateAvailable = ({ rates, currency }) => {
    const normalized = normalizeCurrencyCode(currency);
    const rate = Number(rates?.[normalized]);
    if (!Number.isFinite(rate) || rate <= 0) {
        throw new AppError(`Cached FX rate is unavailable for ${normalized}`, 409);
    }
    return rate;
};

const getFxQuote = async ({
    baseCurrency,
    targetCurrency,
    amount,
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
            staleReason: '',
        };
    }

    const ratesPayload = await getFxRates({ allowStale: true });
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
        normalizedTargetCurrency,
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

const getFxRefreshStatus = async () => {
    const snapshot = await loadSnapshotFromStore().catch(() => null);
    const expired = isSnapshotExpired(snapshot);
    const nextEligibleRefreshAt = snapshot?.lastSuccessfulRefreshAt
        ? new Date(new Date(snapshot.lastSuccessfulRefreshAt).getTime() + getRefreshIntervalMs()).toISOString()
        : '';

    return {
        status: snapshot ? (expired ? 'degraded' : 'ok') : 'cold',
        schedulerEnabled: isSchedulerEnabled(),
        cronExpression: getRefreshCron(),
        timezone: getSchedulerTimezone(),
        snapshotAvailable: Boolean(snapshot),
        stale: expired,
        provider: snapshot?.provider || '',
        source: snapshot?.source || '',
        fetchedAt: snapshot?.fetchedAt || '',
        expiresAt: snapshot?.expiresAt || '',
        lastSuccessfulRefreshAt: snapshot?.lastSuccessfulRefreshAt || '',
        lastAttemptAt: snapshot?.lastAttemptAt || '',
        lastFailureAt: snapshot?.lastFailureAt || '',
        lastFailureReason: snapshot?.lastFailureReason || '',
        nextEligibleRefreshAt,
        refreshIntervalMs: getRefreshIntervalMs(),
        rateLimit: buildRateLimitSummary(snapshot),
    };
};

const startFxRateScheduler = () => {
    if (!isSchedulerEnabled()) {
        logger.info('fx.scheduler_disabled');
        return;
    }

    if (state.schedulerTask) {
        return;
    }

    const cronExpression = getRefreshCron();
    if (!cron.validate(cronExpression)) {
        throw new Error(`Invalid PAYMENT_FX_REFRESH_CRON value: ${cronExpression}`);
    }

    state.schedulerTask = cron.schedule(
        cronExpression,
        () => {
            refreshFxRates({ trigger: 'scheduler' }).catch((error) => {
                logger.error('fx.scheduler_cycle_failed', { error: error.message });
            });
        },
        {
            timezone: getSchedulerTimezone(),
        },
    );

    logger.info('fx.scheduler_started', {
        cronExpression,
        timezone: getSchedulerTimezone(),
        refreshIntervalMs: getRefreshIntervalMs(),
    });

    if (isBootstrapEnabled()) {
        Promise.resolve()
            .then(() => refreshFxRates({ trigger: 'startup' }))
            .catch((error) => {
                logger.error('fx.bootstrap_refresh_failed', { error: error.message });
            });
    }
};

const stopFxRateScheduler = () => {
    if (!state.schedulerTask) return;
    state.schedulerTask.stop();
    state.schedulerTask.destroy();
    state.schedulerTask = null;
};

module.exports = {
    getFxRates,
    getFxQuote,
    refreshFxRates,
    startFxRateScheduler,
    stopFxRateScheduler,
    getFxRefreshStatus,
};
