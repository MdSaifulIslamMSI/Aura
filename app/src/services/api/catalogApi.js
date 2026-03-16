import { apiFetch, requestWithTrace, API_BASE_URL as BASE_URL } from '../apiBase';
import { parseApiError, getAuthHeader, runWhenIdle } from './apiUtils';

const PRODUCT_DETAIL_CACHE_TTL_MS = 30 * 1000;
const productDetailCache = new Map();
const productDetailRequestCache = new Map();
const prefetchedProductIds = new Set();

const getProductDetailCacheKey = (id) => String(id ?? '').trim();

const readCachedProductDetail = (id) => {
    const cacheKey = getProductDetailCacheKey(id);
    if (!cacheKey) return null;

    const cached = productDetailCache.get(cacheKey);
    if (!cached) return null;

    if (Date.now() - Number(cached.cachedAt || 0) >= PRODUCT_DETAIL_CACHE_TTL_MS) {
        productDetailCache.delete(cacheKey);
        return null;
    }

    return cached.value || null;
};

const writeCachedProductDetail = (id, product) => {
    const cachedAt = Date.now();
    const keys = new Set([
        getProductDetailCacheKey(id),
        getProductDetailCacheKey(product?.id),
        getProductDetailCacheKey(product?._id),
    ]);

    keys.forEach((cacheKey) => {
        if (!cacheKey) return;
        productDetailCache.set(cacheKey, {
            value: product,
            cachedAt,
        });
    });

    return product;
};

const invalidateProductDetailCache = (id = null) => {
    if (id === null || id === undefined || id === '') {
        productDetailCache.clear();
        productDetailRequestCache.clear();
        return;
    }

    const cacheKey = getProductDetailCacheKey(id);
    if (!cacheKey) return;
    productDetailCache.delete(cacheKey);
    productDetailRequestCache.delete(cacheKey);
};

const fetchProductByIdNetwork = async (id, options = {}) => {
    const cacheKey = getProductDetailCacheKey(id);
    const force = options.force === true;

    if (!force) {
        const cached = readCachedProductDetail(cacheKey);
        if (cached) return cached;

        const pending = productDetailRequestCache.get(cacheKey);
        if (pending) return pending;
    }

    const request = apiFetch(`/products/${id}`, {
        method: 'GET',
        signal: options.signal,
    })
        .then(({ data }) => writeCachedProductDetail(cacheKey, data))
        .finally(() => {
            if (productDetailRequestCache.get(cacheKey) === request) {
                productDetailRequestCache.delete(cacheKey);
            }
        });

    productDetailRequestCache.set(cacheKey, request);
    return request;
};

export const catalogApi = {
    getProducts: async (params = {}, options = {}) => {
        const { data } = await apiFetch('/products', {
            method: 'GET',
            params,
            signal: options.signal,
            timeoutMs: 30000,
            retries: 2,
        });
        return data;
    },
    getProductById: async (id, options = {}) => {
        return fetchProductByIdNetwork(id, options);
    },
    prefetchProductById: (id) => {
        const normalizedId = id == null ? '' : String(id).trim();
        if (!normalizedId || prefetchedProductIds.has(normalizedId)) return;
        prefetchedProductIds.add(normalizedId);

        runWhenIdle(async () => {
            try {
                await fetchProductByIdNetwork(normalizedId);
            } catch {
                // Ignore prefetch errors
            }
        });
    },
    getProductReviews: async (id, params = {}) => {
        const { data } = await apiFetch(`/products/${id}/reviews`, { params });
        return data;
    },
    createProductReview: async (id, payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/products/${id}/reviews`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    visualSearch: async (payload = {}) => {
        const { data } = await apiFetch('/products/visual-search', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        return data;
    },
    buildSmartBundle: async (payload = {}) => {
        const { data } = await apiFetch('/products/bundles/build', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        return data;
    },
    trackSearchClick: async (payload = {}) => {
        try {
            await fetch(`${BASE_URL}/products/telemetry/search-click`, {
                method: 'POST',
                keepalive: true,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });
        } catch {
            // Telemetry is best-effort
        }
    },
    getDealDna: async (id) => {
        const { data } = await apiFetch(`/products/${id}/deal-dna`);
        return data;
    },
    getCompatibility: async (id, params = {}) => {
        const { data } = await apiFetch(`/products/${id}/compatibility`, { params });
        return data;
    },
    getRecommendations: async (payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/products/recommendations', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    createProduct: async (payload = {}) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch('/products', {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        return data;
    },
    updateProduct: async (product) => {
        const headers = await getAuthHeader();
        const { _id, id, ...payload } = product || {};
        const { data } = await apiFetch(`/products/${_id || id}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(payload),
        });
        writeCachedProductDetail(_id || id || data?._id || data?.id, data);
        return data;
    },
    deleteProduct: async (id) => {
        const headers = await getAuthHeader();
        const { data } = await apiFetch(`/products/${id}`, {
            method: 'DELETE',
            headers,
        });
        invalidateProductDetailCache(id);
        return data;
    }
};

export const productApi = catalogApi;
