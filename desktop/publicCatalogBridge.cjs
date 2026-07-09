const NUMERIC_PRODUCT_ID_PATTERN = /^\d+$/;
const MONGO_PRODUCT_ID_PATTERN = /^[a-f0-9]{24}$/i;

const trimTrailingSlash = (value = '') => String(value || '').replace(/\/+$/, '');

const isPublicProductId = value => (
    NUMERIC_PRODUCT_ID_PATTERN.test(value)
    || MONGO_PRODUCT_ID_PATTERN.test(value)
);

const normalizePublicCatalogPath = (path = '/products') => {
    const rawPath = String(path || '/products').trim();
    const pathname = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const apiStrippedPath = pathname.replace(/^\/api(?=\/)/i, '');
    const segments = apiStrippedPath.split('/').filter(Boolean);

    if (segments.length === 1 && segments[0] === 'products') {
        return '/api/products';
    }

    if (
        segments.length === 2
        && segments[0] === 'products'
        && isPublicProductId(segments[1])
    ) {
        return `/api/products/${encodeURIComponent(segments[1])}`;
    }

    const error = new Error('Desktop public catalog bridge only supports product list and product detail reads.');
    error.statusCode = 400;
    throw error;
};

const appendParams = (url, params = {}) => {
    if (!params || typeof params !== 'object') {
        return;
    }

    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
            return;
        }

        if (Array.isArray(value)) {
            value.forEach((entry) => {
                if (entry !== undefined && entry !== null && entry !== '') {
                    url.searchParams.append(key, String(entry));
                }
            });
            return;
        }

        url.searchParams.append(key, String(value));
    });
};

const parseJsonSafely = async (response) => {
    const text = await response.text();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

const createPublicCatalogFetch = ({
    backendOrigin,
    fetchImpl = globalThis.fetch,
    timeoutMs = 12000,
} = {}) => async ({ path = '/products', params = {} } = {}) => {
    if (typeof fetchImpl !== 'function') {
        throw new Error('Desktop public catalog bridge cannot fetch in this runtime.');
    }

    const baseOrigin = trimTrailingSlash(backendOrigin);
    if (!/^https:\/\//i.test(baseOrigin)) {
        throw new Error('Desktop public catalog bridge requires an HTTPS backend origin.');
    }

    const url = new URL(normalizePublicCatalogPath(path), baseOrigin);
    appendParams(url, params);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetchImpl(url.toString(), {
            method: 'GET',
            headers: {
                Accept: 'application/json',
                'X-Aura-Desktop-Catalog-Bridge': '1',
            },
            signal: controller.signal,
        });
        const data = await parseJsonSafely(response);
        return {
            ok: response.ok,
            status: response.status,
            requestId: response.headers?.get?.('x-request-id') || '',
            data,
        };
    } finally {
        clearTimeout(timeout);
    }
};

module.exports = {
    createPublicCatalogFetch,
    normalizePublicCatalogPath,
};
