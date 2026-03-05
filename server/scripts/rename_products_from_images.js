require('dotenv').config();

const https = require('https');
const mongoose = require('mongoose');
const Product = require('../models/Product');

const BATCH_SIZE = Number(process.env.RENAME_PRODUCTS_BATCH_SIZE || 500);

const getJson = (url) => new Promise((resolve, reject) => {
    https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            try {
                resolve(JSON.parse(data));
            } catch (error) {
                reject(error);
            }
        });
    }).on('error', reject);
});

const normalizeText = (value) => String(value || '').trim();
const collapseSpaces = (value) => normalizeText(value).replace(/\s+/g, ' ');

const normalizeImageLookupKey = (value) => {
    const raw = normalizeText(value);
    if (!raw) return '';
    try {
        const url = new URL(raw);
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch {
        return raw.split('?')[0].split('#')[0];
    }
};

const toTitleCase = (value) => collapseSpaces(value)
    .split(' ')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');

const humanizeSlug = (slug) => toTitleCase(
    normalizeText(slug)
        .replace(/\.(jpg|jpeg|png|webp|gif|svg)$/i, '')
        .replace(/[_-]+/g, ' ')
);

const deriveTitleFromImageUrl = (imageUrl, fallbackCategory, fallbackId) => {
    const trimmed = normalizeText(imageUrl);
    if (!trimmed) return `Product ${fallbackId}`;

    try {
        const url = new URL(trimmed);
        const segments = url.pathname.split('/').filter(Boolean);
        const productImagesIdx = segments.findIndex((segment) => segment === 'product-images');
        if (productImagesIdx >= 0 && segments.length > productImagesIdx + 2) {
            const slug = segments[productImagesIdx + 2];
            const title = humanizeSlug(slug);
            if (title) return title;
        }

        if (url.hostname.includes('wikimedia.org')) {
            const last = segments[segments.length - 1] || '';
            const title = humanizeSlug(decodeURIComponent(last));
            if (title) return title;
        }
    } catch {
        // Ignore parse failure and use fallback
    }

    return `${toTitleCase(fallbackCategory || 'Product')} ${fallbackId}`;
};

const buildSearchText = (record = {}) => [
    normalizeText(record.title),
    normalizeText(record.brand),
    normalizeText(record.category),
    normalizeText(record.description),
    Array.isArray(record.highlights) ? record.highlights.join(' ') : '',
].filter(Boolean).join(' | ');

const buildDummyJsonImageMetadataMap = async () => {
    const categories = await getJson('https://dummyjson.com/products/categories');
    const slugs = Array.isArray(categories) ? categories.map((entry) => entry.slug).filter(Boolean) : [];
    const map = new Map();

    for (const slug of slugs) {
        try {
            const payload = await getJson(`https://dummyjson.com/products/category/${slug}?limit=200`);
            const products = Array.isArray(payload?.products) ? payload.products : [];

            for (const product of products) {
                const meta = {
                    title: normalizeText(product.title),
                    brand: normalizeText(product.brand),
                    category: normalizeText(product.category),
                };

                const urls = [
                    normalizeText(product.thumbnail),
                    ...(Array.isArray(product.images) ? product.images : []).map((entry) => normalizeText(entry)),
                ].filter(Boolean);

                for (const imageUrl of urls) {
                    map.set(normalizeImageLookupKey(imageUrl), meta);
                }
            }
        } catch (error) {
            // Continue with remaining categories; fallback logic handles misses.
            // No throw to keep migration resilient.
        }
    }

    return map;
};

const ensureUniqueTitle = (baseTitle, productId, usedTitleKeys) => {
    const normalizedBase = collapseSpaces(baseTitle) || `Product ${productId}`;
    let candidate = normalizedBase;
    let key = Product.normalizeTitleKey(candidate);
    if (!key) {
        candidate = `Product ${productId}`;
        key = Product.normalizeTitleKey(candidate);
    }

    if (!usedTitleKeys.has(key)) {
        usedTitleKeys.add(key);
        return candidate;
    }

    let counter = 1;
    while (true) {
        const withSuffix = `${normalizedBase} ${productId}${counter === 1 ? '' : `-${counter}`}`;
        const suffixKey = Product.normalizeTitleKey(withSuffix);
        if (!usedTitleKeys.has(suffixKey)) {
            usedTitleKeys.add(suffixKey);
            return withSuffix;
        }
        counter += 1;
    }
};

const run = async () => {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI missing in environment');

    console.log('[rename] building external image metadata map...');
    const imageMetaMap = await buildDummyJsonImageMetadataMap();
    console.log(`[rename] metadata entries=${imageMetaMap.size.toLocaleString()}`);

    await mongoose.connect(process.env.MONGO_URI);
    const total = await Product.countDocuments({});
    console.log(`[rename] products=${total.toLocaleString()}`);

    const cursor = Product.find({})
        .sort({ _id: 1 })
        .select('_id id title brand category image description highlights')
        .lean()
        .cursor();

    const usedTitleKeys = new Set();
    const operations = [];
    let scanned = 0;
    let updated = 0;
    let skipped = 0;

    const flush = async () => {
        if (operations.length === 0) return 0;
        const chunk = operations.splice(0, operations.length);
        await Product.bulkWrite(chunk, { ordered: false });
        return chunk.length;
    };

    for await (const product of cursor) {
        scanned += 1;
        const id = Number(product.id) || scanned;
        const imageKey = normalizeImageLookupKey(product.image);
        const meta = imageMetaMap.get(imageKey);

        const baseTitle = meta?.title
            || deriveTitleFromImageUrl(product.image, product.category, id);
        const nextTitle = ensureUniqueTitle(baseTitle, id, usedTitleKeys);

        const nextBrand = meta?.brand || collapseSpaces(product.brand || 'Unknown');
        const nextSearchText = buildSearchText({
            title: nextTitle,
            brand: nextBrand,
            category: product.category,
            description: product.description,
            highlights: product.highlights,
        });
        const nextTitleKey = Product.normalizeTitleKey(nextTitle);

        if (
            nextTitle === product.title
            && nextBrand === product.brand
        ) {
            skipped += 1;
        } else {
            operations.push({
                updateOne: {
                    filter: { _id: product._id },
                    update: {
                        $set: {
                            title: nextTitle,
                            titleKey: nextTitleKey,
                            brand: nextBrand,
                            searchText: nextSearchText,
                            updatedAt: new Date(),
                        },
                    },
                },
            });
        }

        if (operations.length >= BATCH_SIZE) {
            updated += await flush();
        }

        if (scanned % 10000 === 0) {
            console.log(`[rename] scanned=${scanned.toLocaleString()} queued=${operations.length} updated~=${Math.min(updated + operations.length, scanned).toLocaleString()} skipped=${skipped.toLocaleString()}`);
        }
    }

    const pending = operations.length;
    updated += await flush();

    console.log('[rename] done', JSON.stringify({
        scanned,
        updated,
        skipped,
    }, null, 2));
};

run()
    .catch((error) => {
        console.error('[rename] failed', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
