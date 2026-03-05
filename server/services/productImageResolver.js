const crypto = require('crypto');
const { CATEGORY_IMAGE_POOLS } = require('../config/productImagePools');

const BAD_IMAGE_HOSTS = new Set([
    'picsum.photos',
    'via.placeholder.com',
    'placehold.co',
    'dummyimage.com',
    'loremflickr.com',
]);

const normalizeText = (value) => String(value || '').trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();
const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || '').trim());

const hostFromUrl = (value) => {
    try {
        return new URL(String(value || '').trim()).hostname.toLowerCase();
    } catch {
        return '';
    }
};

const isWeakImageUrl = (value) => {
    const image = normalizeText(value);
    if (!image || !isHttpUrl(image)) return true;
    return BAD_IMAGE_HOSTS.has(hostFromUrl(image));
};

const CATEGORY_ALIASES = {
    electronics: 'electronics',
    mobile: 'mobiles',
    mobiles: 'mobiles',
    smartphone: 'mobiles',
    smartphones: 'mobiles',
    laptop: 'laptops',
    laptops: 'laptops',
    "men's fashion": "men's fashion",
    'mens fashion': "men's fashion",
    "women's fashion": "women's fashion",
    'womens fashion': "women's fashion",
    'home & kitchen': 'home & kitchen',
    'home kitchen': 'home & kitchen',
    books: 'books',
    book: 'books',
    footwear: 'footwear',
    gaming: 'gaming & accessories',
    'gaming & accessories': 'gaming & accessories',
};

const resolveCategoryPoolKey = (category) => {
    const key = normalizeKey(category);
    return CATEGORY_ALIASES[key] || 'misc';
};

const pickPool = (category) => {
    const key = resolveCategoryPoolKey(category);
    const pool = CATEGORY_IMAGE_POOLS[key];
    if (Array.isArray(pool) && pool.length > 0) return { pool, key };
    return { pool: CATEGORY_IMAGE_POOLS.misc || [], key: 'misc' };
};

const buildStableUid = ({
    source = '',
    catalogVersion = '',
    externalId = '',
    id = '',
    title = '',
    brand = '',
    category = '',
}) => crypto.createHash('sha1')
    .update(`${source}|${catalogVersion}|${externalId}|${id}|${title}|${brand}|${category}`)
    .digest('hex');

const buildSemanticImageUrl = (payload) => {
    const uid = buildStableUid(payload);
    const hash = parseInt(uid.slice(0, 8), 16);
    const idCandidate = Number(payload.id);
    const stableId = Number.isFinite(idCandidate) && idCandidate > 0 ? idCandidate : hash;
    const { pool } = pickPool(payload.category);

    if (!Array.isArray(pool) || pool.length === 0) {
        return `https://cdn.dummyjson.com/product-images/smartphones/iphone-13/1.webp?pid=${stableId}`;
    }

    const base = pool[hash % pool.length];
    const separator = String(base).includes('?') ? '&' : '?';
    // Preserve strict URL uniqueness by product identity while keeping category-accurate base image.
    return `${base}${separator}pid=${stableId}`;
};

const resolveProductImage = ({
    existingImage = '',
    title = '',
    brand = '',
    category = '',
    source = '',
    catalogVersion = '',
    externalId = '',
    id = '',
    forceSemantic = false,
}) => {
    const trimmed = normalizeText(existingImage);
    if (!forceSemantic && !isWeakImageUrl(trimmed)) {
        return trimmed;
    }

    return buildSemanticImageUrl({
        title,
        brand,
        category,
        source,
        catalogVersion,
        externalId,
        id,
    });
};

module.exports = {
    resolveProductImage,
    buildSemanticImageUrl,
    isWeakImageUrl,
};
