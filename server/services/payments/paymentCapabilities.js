const AppError = require('../../utils/AppError');
const {
    getNetbankingBankCatalog,
    normalizeSupportedBanksResponse,
} = require('./netbankingCatalog');
const { getPaymentMarketCatalog } = require('./paymentMarketCatalog');

const DEFAULT_TTL_MS = 10 * 60 * 1000;

const UPI_APP_NAMES = {
    gpay: 'Google Pay',
    phonepe: 'PhonePe',
    paytm: 'Paytm',
    bhim: 'BHIM',
    amazonpay: 'Amazon Pay',
    cred: 'CRED',
    whatsapp: 'WhatsApp Pay',
};

const WALLET_NAMES = {
    airtelmoney: 'Airtel Money',
    amazonpay: 'Amazon Pay',
    freecharge: 'Freecharge',
    jiomoney: 'JioMoney',
    mobikwik: 'MobiKwik',
    ola_money: 'Ola Money',
    paytm: 'Paytm Wallet',
    phonepe: 'PhonePe Wallet',
};

const CARD_NETWORK_NAMES = {
    amex: 'Amex',
    diners: 'Diners Club',
    discover: 'Discover',
    jcb: 'JCB',
    maestro: 'Maestro',
    mastercard: 'Mastercard',
    rupay: 'RuPay',
    visa: 'Visa',
};

let capabilitiesCache = {
    data: null,
    expiresAt: 0,
    inFlight: null,
};

const normalizeCode = (value) => String(value || '').trim();
const normalizeUpper = (value) => normalizeCode(value).toUpperCase();
const normalizeLower = (value) => normalizeCode(value).toLowerCase();

const titleCase = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const parseCapabilitiesTtl = () => {
    const raw = Number.parseInt(String(process.env.PAYMENT_CAPABILITIES_TTL_MS || ''), 10);
    if (!Number.isFinite(raw) || raw < 60_000) return DEFAULT_TTL_MS;
    return Math.min(raw, 24 * 60 * 60 * 1000);
};

const toNamedList = ({
    raw = [],
    normalizeItem,
    sortLocale = 'en-IN',
}) => {
    const map = new Map();
    raw.forEach((item) => {
        const normalized = normalizeItem(item);
        if (!normalized?.code) return;
        const existing = map.get(normalized.code);
        map.set(normalized.code, {
            code: normalized.code,
            name: normalized.name || existing?.name || normalized.code,
        });
    });
    return Array.from(map.values()).sort((left, right) => left.name.localeCompare(right.name, sortLocale));
};

const objectOrArrayValues = (value) => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.entries(value).map(([code, entry]) => ({ code, entry }));
    return [];
};

const normalizeBooleanMapEntry = (rawItem, {
    normalizeCodeFn = normalizeUpper,
    names = {},
}) => {
    if (rawItem === null || rawItem === undefined || rawItem === false) return null;

    if (typeof rawItem === 'string') {
        const code = normalizeCodeFn(rawItem);
        if (!code) return null;
        return {
            code,
            name: names[normalizeLower(code)] || titleCase(rawItem.replace(/[_-]+/g, ' ')),
        };
    }

    if (Array.isArray(rawItem)) {
        return normalizeBooleanMapEntry(rawItem[0], { normalizeCodeFn, names });
    }

    if (rawItem && typeof rawItem === 'object' && 'code' in rawItem && !('entry' in rawItem)) {
        const code = normalizeCodeFn(rawItem.code);
        if (!code) return null;
        if (rawItem.enabled === false || rawItem.available === false || rawItem.live === false) return null;
        return {
            code,
            name: rawItem.name || rawItem.label || names[normalizeLower(code)] || titleCase(code.replace(/[_-]+/g, ' ')),
        };
    }

    if (rawItem && typeof rawItem === 'object' && 'code' in rawItem && 'entry' in rawItem) {
        const code = normalizeCodeFn(rawItem.code);
        if (!code) return null;
        const entry = rawItem.entry;
        if (entry === false || entry === null || entry === undefined) return null;
        if (typeof entry === 'string') {
            return {
                code,
                name: entry || names[normalizeLower(code)] || titleCase(code.replace(/[_-]+/g, ' ')),
            };
        }
        if (typeof entry === 'boolean') {
            return {
                code,
                name: names[normalizeLower(code)] || titleCase(code.replace(/[_-]+/g, ' ')),
            };
        }
        if (entry && typeof entry === 'object') {
            if (entry.enabled === false || entry.available === false || entry.live === false) return null;
            return {
                code,
                name: entry.name || entry.label || names[normalizeLower(code)] || titleCase(code.replace(/[_-]+/g, ' ')),
            };
        }
    }

    return null;
};

const normalizeUpiApps = (payload = {}) => {
    const rawApps = payload?.upi?.apps
        || payload?.upi?.intent_apps
        || payload?.upi?.intentApps
        || payload?.upi?.psps
        || payload?.upi?.providers
        || [];

    const apps = toNamedList({
        raw: objectOrArrayValues(rawApps),
        normalizeItem: (item) => normalizeBooleanMapEntry(item, {
            normalizeCodeFn: normalizeLower,
            names: UPI_APP_NAMES,
        }),
    });

    const available = Boolean(
        apps.length
        || payload?.upi === true
        || payload?.upi?.enabled
        || payload?.upi?.intent === true
        || payload?.upi?.collect === true
    );

    const flows = [];
    if (payload?.upi?.intent !== false) flows.push('intent');
    if (payload?.upi?.collect === true) flows.push('collect');

    return {
        available,
        apps,
        flows: flows.length ? flows : ['intent'],
        appCount: apps.length,
    };
};

const normalizeWallets = (payload = {}) => {
    const rawWallets = payload?.wallet?.wallets
        || payload?.wallets
        || payload?.wallet
        || [];

    const wallets = toNamedList({
        raw: objectOrArrayValues(rawWallets),
        normalizeItem: (item) => normalizeBooleanMapEntry(item, {
            normalizeCodeFn: normalizeLower,
            names: WALLET_NAMES,
        }),
    });

    return {
        available: Boolean(wallets.length || payload?.wallet === true || payload?.wallet?.enabled),
        wallets,
        walletCount: wallets.length,
    };
};

const normalizeCardCapabilities = (payload = {}) => {
    const rawCard = payload?.card || payload?.cards || {};
    const rawNetworks = rawCard?.networks || rawCard?.network || [];
    const rawIssuers = rawCard?.issuers || rawCard?.banks || [];
    const rawTypes = rawCard?.types || rawCard?.funding || [];

    const networks = toNamedList({
        raw: objectOrArrayValues(rawNetworks),
        normalizeItem: (item) => normalizeBooleanMapEntry(item, {
            normalizeCodeFn: normalizeLower,
            names: CARD_NETWORK_NAMES,
        }),
    });

    const issuers = toNamedList({
        raw: objectOrArrayValues(rawIssuers),
        normalizeItem: (item) => normalizeBooleanMapEntry(item, {
            normalizeCodeFn: normalizeUpper,
            names: {},
        }),
    });

    const types = toNamedList({
        raw: objectOrArrayValues(rawTypes),
        normalizeItem: (item) => normalizeBooleanMapEntry(item, {
            normalizeCodeFn: normalizeLower,
            names: {
                credit: 'Credit',
                debit: 'Debit',
                prepaid: 'Prepaid',
                emi: 'EMI',
            },
        }),
    });

    return {
        available: Boolean(
            payload?.card === true
            || payload?.cards === true
            || rawCard?.enabled
            || networks.length
            || issuers.length
        ),
        networks,
        issuers,
        types,
        networkCount: networks.length,
        issuerCount: issuers.length,
    };
};

const buildFallbackCapabilities = async () => {
    const netbanking = await getNetbankingBankCatalog({ allowFallback: true });
    const rails = {
        upi: {
            available: true,
            apps: [
                { code: 'gpay', name: 'Google Pay' },
                { code: 'phonepe', name: 'PhonePe' },
                { code: 'paytm', name: 'Paytm' },
                { code: 'bhim', name: 'BHIM' },
            ],
            flows: ['intent'],
            appCount: 4,
        },
        card: {
            available: true,
            networks: [
                { code: 'visa', name: 'Visa' },
                { code: 'mastercard', name: 'Mastercard' },
                { code: 'rupay', name: 'RuPay' },
                { code: 'amex', name: 'Amex' },
            ],
            issuers: [],
            types: [
                { code: 'credit', name: 'Credit' },
                { code: 'debit', name: 'Debit' },
            ],
            networkCount: 4,
            issuerCount: 0,
        },
        wallet: {
            available: true,
            wallets: [
                { code: 'paytm', name: 'Paytm Wallet' },
                { code: 'mobikwik', name: 'MobiKwik' },
                { code: 'freecharge', name: 'Freecharge' },
            ],
            walletCount: 3,
        },
        netbanking: {
            available: true,
            bankCount: netbanking.banks.length,
            featuredBanks: netbanking.featuredBanks,
        },
    };

    return {
        provider: 'razorpay',
        source: 'fallback',
        stale: true,
        fetchedAt: new Date(0).toISOString(),
        ttlSeconds: Math.round(parseCapabilitiesTtl() / 1000),
        rails,
        markets: getPaymentMarketCatalog({ capabilities: { rails } }),
    };
};

const normalizePaymentCapabilities = (payload = {}) => {
    const netbanking = normalizeSupportedBanksResponse(payload);
    const rails = {
        upi: normalizeUpiApps(payload),
        card: normalizeCardCapabilities(payload),
        wallet: normalizeWallets(payload),
        netbanking: {
            available: netbanking.banks.length > 0 || payload?.netbanking === true,
            bankCount: netbanking.banks.length,
            featuredBanks: netbanking.featuredBanks,
        },
    };

    return {
        rails,
        markets: getPaymentMarketCatalog({ capabilities: { rails } }),
    };
};

const getPaymentCapabilities = async ({
    provider,
    forceRefresh = false,
    allowFallback = true,
} = {}) => {
    const ttlMs = parseCapabilitiesTtl();
    const now = Date.now();

    if (!forceRefresh && capabilitiesCache.data && capabilitiesCache.expiresAt > now) {
        return capabilitiesCache.data;
    }

    if (!forceRefresh && capabilitiesCache.inFlight) {
        return capabilitiesCache.inFlight;
    }

    if (!provider || typeof provider.fetchSupportedMethods !== 'function') {
        if (capabilitiesCache.data) {
            return {
                ...capabilitiesCache.data,
                stale: true,
                source: 'cache',
            };
        }
        if (allowFallback) return buildFallbackCapabilities();
        throw new AppError('Payment capabilities are unavailable right now', 503);
    }

    capabilitiesCache.inFlight = (async () => {
        try {
            const methods = await provider.fetchSupportedMethods();
            const normalized = normalizePaymentCapabilities(methods);
            const capabilities = {
                provider: provider.name || 'razorpay',
                source: 'provider',
                stale: false,
                fetchedAt: new Date().toISOString(),
                ttlSeconds: Math.round(ttlMs / 1000),
                ...normalized,
            };

            capabilitiesCache = {
                data: capabilities,
                expiresAt: Date.now() + ttlMs,
                inFlight: null,
            };
            return capabilities;
        } catch (error) {
            if (capabilitiesCache.data) {
                return {
                    ...capabilitiesCache.data,
                    stale: true,
                    source: 'cache',
                    staleReason: error.message || 'provider_unavailable',
                };
            }

            if (allowFallback) {
                return {
                    ...(await buildFallbackCapabilities()),
                    staleReason: error.message || 'provider_unavailable',
                };
            }

            throw new AppError(
                error.message || 'Unable to fetch payment capabilities right now',
                error.statusCode || 502
            );
        } finally {
            capabilitiesCache.inFlight = null;
        }
    })();

    return capabilitiesCache.inFlight;
};

module.exports = {
    getPaymentCapabilities,
    normalizePaymentCapabilities,
};
