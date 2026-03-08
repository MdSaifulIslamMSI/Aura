const crypto = require('crypto');
const path = require('path');
const { CATEGORY_IMAGE_POOLS } = require('../config/productImagePools');

const BAD_IMAGE_HOSTS = new Set([
    'picsum.photos',
    'via.placeholder.com',
    'placehold.co',
    'dummyimage.com',
    'loremflickr.com',
]);
const PROXY_IMAGE_HOST_PATTERNS = [
    /(^|\.)flixcart\.com$/i,
    /(^|\.)flipkart\.com$/i,
];

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

const canonicalizeProductImageUrl = (value) => {
    const image = normalizeText(value);
    if (!isHttpUrl(image)) return image;

    try {
        return new URL(image).toString();
    } catch {
        return image;
    }
};

const shouldProxyProductImage = (value) => {
    const image = canonicalizeProductImageUrl(value);
    if (!isHttpUrl(image)) return false;
    return PROXY_IMAGE_HOST_PATTERNS.some((pattern) => pattern.test(hostFromUrl(image)));
};

const buildProductImageFetchUrl = (value) => {
    const image = canonicalizeProductImageUrl(value);
    if (!shouldProxyProductImage(image)) return image;

    try {
        const parsed = new URL(image);
        parsed.protocol = 'http:';
        return parsed.toString();
    } catch {
        return image;
    }
};

const buildProductImageDeliveryUrl = (value) => {
    const image = canonicalizeProductImageUrl(value);
    if (!shouldProxyProductImage(image)) return image;
    return `/api/products/image-proxy?url=${encodeURIComponent(image)}`;
};

const isWeakImageUrl = (value) => {
    const image = canonicalizeProductImageUrl(value);
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
const TOKEN_CASE_OVERRIDES = {
    adidas: 'Adidas',
    amazon: 'Amazon',
    apple: 'Apple',
    aorus: 'Aorus',
    asus: 'Asus',
    beats: 'Beats',
    cellini: 'Cellini',
    cleats: 'Cleats',
    dell: 'Dell',
    echo: 'Echo',
    galaxy: 'Galaxy',
    gigabyte: 'Gigabyte',
    hp: 'HP',
    huawei: 'Huawei',
    iphone: 'iPhone',
    ipad: 'iPad',
    jbl: 'JBL',
    keyboard: 'Keyboard',
    lenovo: 'Lenovo',
    magsafe: 'MagSafe',
    macbook: 'MacBook',
    nike: 'Nike',
    oppo: 'Oppo',
    playstation: 'PlayStation',
    realme: 'Realme',
    redmi: 'Redmi',
    rgb: 'RGB',
    rolex: 'Rolex',
    samsung: 'Samsung',
    silver: 'Silver',
    sony: 'Sony',
    tab: 'Tab',
    tshirt: 'T-Shirt',
    ultrabook: 'Ultrabook',
    vivo: 'Vivo',
    xiaomi: 'Xiaomi',
    xps: 'XPS',
};
const IMAGE_GROUP_LABEL_OVERRIDES = {
    'laptops/new-dell-xps-13-9300-laptop': 'Dell XPS 13 9300 Laptop',
    'sports-accessories/iron-golf': 'Golf Club',
    'mobile-accessories/tv-studio-camera-pedestal': 'Studio Camera Pedestal',
    'tops/girl-summer-dress': 'Summer Dress',
    'womens-bags/women-handbag-black': "Women's Handbag",
    'womens-dresses/dress-pea': 'Pea Green Dress',
    'womens-shoes/golden-shoes-woman': "Golden Women's Shoes",
    'womens-shoes/pampi-shoes': 'Pampi Heels',
    'womens-watches/watch-gold-for-women': "Women's Gold Watch",
    'upload.wikimedia.org/book-icon-': 'Classic Book',
    'upload.wikimedia.org/book-pile': 'Book Collection',
    'upload.wikimedia.org/book-svg': 'Book Collection',
    'upload.wikimedia.org/books-aj-svg-aj-ashton-01': 'Illustrated Book Collection',
    'upload.wikimedia.org/books-hc-1090': 'Hardcover Book Set',
    'upload.wikimedia.org/bookshelf': 'Bookshelf Collection',
    'upload.wikimedia.org/bookshelf-icon-svg': 'Bookshelf Display',
    'upload.wikimedia.org/bookshelf-with-books': 'Bookshelf Collection',
    'upload.wikimedia.org/grosset-dunlap-book-cover-design-for-pony-tracks-': 'Vintage Book Cover',
    'upload.wikimedia.org/stack-of-books': 'Stack Of Books',
};
const CATEGORY_GROUP_FILTERS = {
    books: (group) => !new Set([
        'upload.wikimedia.org/book-icon-',
        'upload.wikimedia.org/book-svg',
        'upload.wikimedia.org/books-aj-svg-aj-ashton-01',
        'upload.wikimedia.org/bookshelf-icon-svg',
    ]).has(group.key),
    'home & kitchen': (group) => /^(home-decoration|kitchen-accessories)\//i.test(group.key),
};
const groupedPoolCache = new Map();

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

const humanizeSlug = (value) => String(value || '')
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((token) => {
        const normalized = token.toLowerCase();
        if (TOKEN_CASE_OVERRIDES[normalized]) {
            return TOKEN_CASE_OVERRIDES[normalized];
        }
        if (/^\d+[a-z]?$/i.test(token)) {
            return token.toUpperCase();
        }
        return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(' ')
    .trim();

const normalizeGroupLabel = (key, label) => {
    const overridden = IMAGE_GROUP_LABEL_OVERRIDES[key];
    if (overridden) {
        return overridden;
    }

    return String(label || '')
        .replace(/\bSvg\b/gi, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/^New\s+/i, '')
        .replace(/^Girl\s+/i, '')
        .trim() || 'Catalog Select';
};

const deriveImageGroupMeta = (value) => {
    const image = canonicalizeProductImageUrl(value);
    if (!image) {
        return { key: 'misc/default', label: 'Catalog Select' };
    }

    try {
        const parsed = new URL(image);
        const segments = parsed.pathname.split('/').filter(Boolean);

        if (/(^|\.)dummyjson\.com$/i.test(parsed.hostname)) {
            const rootIndex = segments.findIndex((segment) => segment === 'product-images');
            const categorySegment = segments[rootIndex + 1] || 'misc';
            const slug = segments[rootIndex + 2] || path.basename(segments[segments.length - 1] || '', path.extname(segments[segments.length - 1] || ''));
            const key = `${categorySegment}/${slug}`;
            return {
                key,
                label: normalizeGroupLabel(key, humanizeSlug(slug)),
            };
        }

        const filename = decodeURIComponent(segments[segments.length - 1] || 'item');
        const cleanedFile = filename
            .replace(/\.[a-z0-9]+$/i, '')
            .replace(/^\d+px-/i, '')
            .replace(/\([^)]*\)/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const key = `${parsed.hostname}/${cleanedFile.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        return {
            key,
            label: normalizeGroupLabel(key, humanizeSlug(cleanedFile)),
        };
    } catch {
        const fallback = image.replace(/\.[a-z0-9]+$/i, '').split('/').pop() || 'catalog-select';
        const key = `misc/${fallback.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        return {
            key,
            label: normalizeGroupLabel(key, humanizeSlug(fallback)),
        };
    }
};

const getGroupedPool = (category) => {
    const key = resolveCategoryPoolKey(category);
    if (groupedPoolCache.has(key)) {
        return groupedPoolCache.get(key);
    }

    const { pool } = pickPool(category);
    const groups = new Map();
    for (const rawUrl of pool) {
        const url = canonicalizeProductImageUrl(rawUrl);
        if (!url) continue;
        const meta = deriveImageGroupMeta(url);
        const existing = groups.get(meta.key) || { key: meta.key, label: meta.label, urls: [] };
        if (!existing.urls.includes(url)) {
            existing.urls.push(url);
        }
        groups.set(meta.key, existing);
    }

    const grouped = [...groups.values()].filter((entry) => entry.urls.length > 0);
    const filter = CATEGORY_GROUP_FILTERS[key];
    const filtered = typeof filter === 'function'
        ? grouped.filter((entry) => filter(entry))
        : grouped;
    const finalGroups = filtered.length > 0 ? filtered : grouped;
    groupedPoolCache.set(key, finalGroups);
    return finalGroups;
};

const scoreImageGroup = (group, payload = {}) => {
    const label = normalizeKey(group.label);
    const titleTokens = normalizeKey(`${payload.title || ''} ${payload.brand || ''}`)
        .split(/\s+/)
        .filter(Boolean);
    let score = 0;

    for (const token of titleTokens) {
        if (token.length < 2) continue;
        if (label === token) score += 10;
        else if (label.startsWith(token)) score += 7;
        else if (label.includes(token)) score += 4;
    }

    return score;
};

const buildDecoratedImageUrl = (base, stableId, slotIndex) => {
    const separator = String(base).includes('?') ? '&' : '?';
    return `${base}${separator}pid=${stableId}&slot=${slotIndex + 1}`;
};

const selectSemanticImageSet = (payload, count = 4) => {
    const uid = buildStableUid({
        ...payload,
        title: '',
    });
    const hash = parseInt(uid.slice(0, 8), 16);
    const idCandidate = Number(payload.id);
    const stableId = Number.isFinite(idCandidate) && idCandidate > 0 ? idCandidate : hash;
    const groups = getGroupedPool(payload.category);

    if (!Array.isArray(groups) || groups.length === 0) {
        const fallback = buildDecoratedImageUrl('https://cdn.dummyjson.com/product-images/smartphones/iphone-13/1.webp', stableId, 0);
        return {
            primaryImage: fallback,
            gallery: [fallback],
            label: 'Apple iPhone 13',
            groupKey: 'fallback/iphone-13',
        };
    }

    let bestScore = -1;
    let candidates = [];
    groups.forEach((group, index) => {
        const score = scoreImageGroup(group, payload);
        if (score > bestScore) {
            bestScore = score;
            candidates = [{ group, index }];
            return;
        }
        if (score === bestScore) {
            candidates.push({ group, index });
        }
    });

    const selectionPool = bestScore > 0 && candidates.length > 0
        ? candidates.map((entry) => entry.group)
        : groups;
    const selectedGroup = selectionPool[hash % selectionPool.length];
    const baseUrls = selectedGroup.urls.slice(0, Math.max(1, Math.min(Number(count) || 4, 6)));
    const gallery = [];
    for (let slotIndex = 0; slotIndex < Math.max(1, Math.min(Number(count) || 4, 6)); slotIndex += 1) {
        const base = baseUrls[slotIndex % baseUrls.length];
        gallery.push(buildDecoratedImageUrl(base, stableId, slotIndex));
    }

    return {
        primaryImage: gallery[0],
        gallery,
        label: selectedGroup.label || 'Catalog Select',
        groupKey: selectedGroup.key || 'misc/selection',
    };
};

const buildSemanticImageUrl = (payload, variantOffset = 0) => {
    const imageSet = selectSemanticImageSet(payload, Math.max(variantOffset + 1, 1));
    return imageSet.gallery[variantOffset] || imageSet.primaryImage;
};

const buildSemanticImageGallery = (payload, count = 4) => {
    return selectSemanticImageSet(payload, count).gallery;
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
    const trimmed = canonicalizeProductImageUrl(existingImage);
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
    buildSemanticImageGallery,
    selectSemanticImageSet,
    isWeakImageUrl,
    canonicalizeProductImageUrl,
    shouldProxyProductImage,
    buildProductImageFetchUrl,
    buildProductImageDeliveryUrl,
};
