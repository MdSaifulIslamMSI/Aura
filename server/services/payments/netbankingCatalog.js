const AppError = require('../../utils/AppError');

const FEATURED_BANK_CODES = [
    'HDFC',
    'ICIC',
    'SBIN',
    'UTIB',
    'KKBK',
    'BARB_R',
    'PUNB_R',
    'IDIB',
    'CNRB',
    'UBIN',
];

const BANK_NAME_OVERRIDES = {
    AIRP: 'Airtel Payments Bank',
    ALLA: 'Indian Bank (Allahabad Bank)',
    AUBL: 'AU Small Finance Bank',
    BARB_R: 'Bank of Baroda',
    BKID: 'Bank of India',
    CNRB: 'Canara Bank',
    CORP: 'Union Bank of India (Corporation Bank)',
    CSBK: 'Catholic Syrian Bank',
    DBSS: 'DBS Bank India',
    DLXB: 'Dhanlaxmi Bank',
    ESFB: 'Equitas Small Finance Bank',
    FDRL: 'Federal Bank',
    HDFC: 'HDFC Bank',
    ICIC: 'ICICI Bank',
    IDFB: 'IDFC FIRST Bank',
    IDIB: 'Indian Bank',
    INDB: 'IndusInd Bank',
    IOBA: 'Indian Overseas Bank',
    JAKA: 'Jammu & Kashmir Bank',
    JSFB: 'Jana Small Finance Bank',
    KARB: 'Karnataka Bank',
    KARU: 'Karur Vysya Bank',
    KKBK: 'Kotak Mahindra Bank',
    KVBL: 'Karur Vysya Bank',
    MAHB: 'Bank of Maharashtra',
    NKGS: 'NKGSB Bank',
    ORBC: 'Oriental Bank of Commerce',
    PSIB: 'Punjab & Sind Bank',
    PUNB_R: 'Punjab National Bank',
    RATN: 'RBL Bank',
    SBIN: 'State Bank of India',
    SCBL: 'Standard Chartered Bank',
    SIBL: 'South Indian Bank',
    SRCB: 'Saraswat Bank',
    SYNB: 'Canara Bank (Syndicate Bank)',
    TMBL: 'Tamilnad Mercantile Bank',
    UCBA: 'UCO Bank',
    UBIN: 'Union Bank of India',
    UTBI: 'Union Bank of India (United Bank)',
    UTIB: 'Axis Bank',
    VIJB: 'Bank of Baroda (Vijaya Bank)',
    YESB: 'YES Bank',
};

const DEFAULT_TTL_MS = 15 * 60 * 1000;

let catalogCache = {
    data: null,
    expiresAt: 0,
    inFlight: null,
};

const normalizeNetbankingBankCode = (value) => String(value || '').trim().toUpperCase();

const titleCase = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const lookupNetbankingBankName = (bankCode, fallback = '') => {
    const normalizedCode = normalizeNetbankingBankCode(bankCode);
    if (!normalizedCode) return String(fallback || '').trim();

    const preferredName = BANK_NAME_OVERRIDES[normalizedCode];
    if (preferredName) return preferredName;

    const fallbackName = String(fallback || '').trim();
    if (fallbackName) {
        return titleCase(
            fallbackName
                .replace(/[_-]+/g, ' ')
                .replace(/\s+/g, ' ')
        );
    }

    return normalizedCode;
};

const parseCatalogTtl = () => {
    const raw = Number.parseInt(String(process.env.PAYMENT_NETBANKING_CATALOG_TTL_MS || ''), 10);
    if (!Number.isFinite(raw) || raw < 60_000) return DEFAULT_TTL_MS;
    return Math.min(raw, 24 * 60 * 60 * 1000);
};

const dedupeBanks = (banks = []) => {
    const seen = new Map();

    banks.forEach((bank) => {
        const code = normalizeNetbankingBankCode(bank?.code);
        if (!code) return;

        const existing = seen.get(code) || {};
        seen.set(code, {
            code,
            name: lookupNetbankingBankName(code, bank?.name || existing.name),
        });
    });

    return Array.from(seen.values());
};

const sortBanks = (banks = []) => {
    const featuredOrder = new Map(FEATURED_BANK_CODES.map((code, index) => [code, index]));

    return [...banks].sort((left, right) => {
        const leftRank = featuredOrder.has(left.code) ? featuredOrder.get(left.code) : Number.MAX_SAFE_INTEGER;
        const rightRank = featuredOrder.has(right.code) ? featuredOrder.get(right.code) : Number.MAX_SAFE_INTEGER;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.name.localeCompare(right.name, 'en-IN');
    });
};

const normalizeProviderEntry = (key, value) => {
    if (value === false || value === null || value === undefined) return null;

    if (typeof value === 'string') {
        const code = normalizeNetbankingBankCode(key) || normalizeNetbankingBankCode(value);
        const name = normalizeNetbankingBankCode(key) ? value : lookupNetbankingBankName(code, value);
        return code ? { code, name } : null;
    }

    if (typeof value === 'boolean') {
        const code = normalizeNetbankingBankCode(key);
        return code ? { code, name: lookupNetbankingBankName(code) } : null;
    }

    if (typeof value === 'object') {
        const code = normalizeNetbankingBankCode(
            value.code || value.bankCode || value.bank || value.id || key
        );
        if (!code) return null;
        if (value.enabled === false || value.available === false || value.live === false) return null;
        return {
            code,
            name: lookupNetbankingBankName(code, value.name || value.bankName || value.label),
        };
    }

    return null;
};

const normalizeSupportedBanksResponse = (payload = {}) => {
    const rawNetbanking = payload?.netbanking?.banks
        || payload?.netbanking
        || payload?.banks
        || [];

    let normalizedBanks = [];

    if (Array.isArray(rawNetbanking)) {
        normalizedBanks = rawNetbanking
            .map((item, index) => normalizeProviderEntry(String(index), item))
            .filter(Boolean);
    } else if (rawNetbanking && typeof rawNetbanking === 'object') {
        normalizedBanks = Object.entries(rawNetbanking)
            .map(([key, value]) => normalizeProviderEntry(key, value))
            .filter(Boolean);
    }

    const banks = sortBanks(dedupeBanks(normalizedBanks));
    const featuredBanks = FEATURED_BANK_CODES
        .map((code) => banks.find((bank) => bank.code === code))
        .filter(Boolean);

    return {
        banks,
        featuredBanks: featuredBanks.length > 0 ? featuredBanks : banks.slice(0, 8),
    };
};

const buildFallbackCatalog = () => {
    const banks = FEATURED_BANK_CODES.map((code) => ({
        code,
        name: lookupNetbankingBankName(code),
    }));

    return {
        provider: 'razorpay',
        source: 'fallback',
        stale: true,
        banks,
        featuredBanks: banks.slice(0, 8),
        fetchedAt: new Date(0).toISOString(),
        ttlSeconds: Math.round(parseCatalogTtl() / 1000),
    };
};

const resolveNetbankingBank = (catalog = {}, bankCode) => {
    const normalizedCode = normalizeNetbankingBankCode(bankCode);
    if (!normalizedCode) return null;
    return (catalog.banks || []).find((bank) => bank.code === normalizedCode) || null;
};

const getNetbankingBankCatalog = async ({
    provider,
    forceRefresh = false,
    allowFallback = true,
} = {}) => {
    const ttlMs = parseCatalogTtl();
    const now = Date.now();

    if (!forceRefresh && catalogCache.data && catalogCache.expiresAt > now) {
        return catalogCache.data;
    }

    if (!forceRefresh && catalogCache.inFlight) {
        return catalogCache.inFlight;
    }

    if (!provider || typeof provider.fetchSupportedMethods !== 'function') {
        if (catalogCache.data) {
            return {
                ...catalogCache.data,
                stale: true,
                source: 'cache',
            };
        }
        if (allowFallback) return buildFallbackCatalog();
        throw new AppError('Netbanking bank directory is unavailable right now', 503);
    }

    catalogCache.inFlight = (async () => {
        try {
            const methods = await provider.fetchSupportedMethods();
            const normalized = normalizeSupportedBanksResponse(methods);
            if (!normalized.banks.length) {
                throw new AppError('Provider returned an empty netbanking directory', 502);
            }

            const catalog = {
                provider: provider.name || 'razorpay',
                source: 'provider',
                stale: false,
                banks: normalized.banks,
                featuredBanks: normalized.featuredBanks,
                fetchedAt: new Date().toISOString(),
                ttlSeconds: Math.round(ttlMs / 1000),
            };

            catalogCache = {
                data: catalog,
                expiresAt: Date.now() + ttlMs,
                inFlight: null,
            };

            return catalog;
        } catch (error) {
            if (catalogCache.data) {
                return {
                    ...catalogCache.data,
                    stale: true,
                    source: 'cache',
                    staleReason: error.message || 'provider_unavailable',
                };
            }

            if (allowFallback) {
                return {
                    ...buildFallbackCatalog(),
                    staleReason: error.message || 'provider_unavailable',
                };
            }

            throw new AppError(
                error.message || 'Unable to fetch supported netbanking banks right now',
                error.statusCode || 502
            );
        } finally {
            catalogCache.inFlight = null;
        }
    })();

    return catalogCache.inFlight;
};

module.exports = {
    FEATURED_BANK_CODES,
    normalizeNetbankingBankCode,
    lookupNetbankingBankName,
    normalizeSupportedBanksResponse,
    getNetbankingBankCatalog,
    resolveNetbankingBank,
};
