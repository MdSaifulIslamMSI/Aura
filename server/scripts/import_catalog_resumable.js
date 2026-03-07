require('dotenv').config();

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const mongoose = require('mongoose');

const Product = require('../models/Product');
const { resolveProductImage } = require('../services/productImageResolver');
const { auditCatalogSample } = require('../services/catalogSourceIntegrityService');

const DATA_FILE = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.join(__dirname, '..', 'data', 'catalog_1m.jsonl');
const TARGET_VERSION = process.env.CATALOG_IMPORT_TARGET_VERSION || 'legacy-v1';
const TARGET_SOURCE = 'batch';
const TARGET_BASE_ID = 100000000;
const TARGET_TOTAL = Number(process.env.CATALOG_IMPORT_TARGET_TOTAL || 1000000);
const BATCH_SIZE = Number(process.env.CATALOG_IMPORT_BATCH_SIZE || 800);
const MAX_RETRIES = Number(process.env.CATALOG_IMPORT_MAX_RETRIES || 8);
const DATASET_AUDIT_SAMPLE_SIZE = Number(process.env.CATALOG_IMPORT_AUDIT_SAMPLE_SIZE || 1000);
const ALLOW_SYNTHETIC_DATASET = String(process.env.CATALOG_IMPORT_ALLOW_SYNTHETIC || 'false').toLowerCase() === 'true';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const safeString = (value, fallback = '') => String(value === undefined || value === null ? fallback : value).trim();
const safeNumber = (value, fallback = 0) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
};
const toInt = (value, fallback = 0) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.trunc(num);
};

const hashValue = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const buildSearchText = (record = {}) => [
    safeString(record.title),
    safeString(record.brand),
    safeString(record.category),
    safeString(record.description),
    Array.isArray(record.highlights) ? record.highlights.join(' ') : '',
].filter(Boolean).join(' | ');
const normalizeTitleKey = (value) => (typeof Product.normalizeTitleKey === 'function'
    ? Product.normalizeTitleKey(value)
    : safeString(value).replace(/\s+/g, ' ').toLowerCase());
const normalizeImageKey = (value) => (typeof Product.normalizeImageKey === 'function'
    ? Product.normalizeImageKey(value)
    : safeString(value).toLowerCase());

const isRetryableMongoError = (error) => {
    const message = String(error?.message || '').toLowerCase();
    return (
        message.includes('econnreset')
        || message.includes('connection')
        || message.includes('topology')
        || message.includes('network')
        || message.includes('timed out')
        || message.includes('socket')
        || message.includes('not primary')
        || message.includes('node is recovering')
    );
};

const connectMongo = async () => {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI missing in environment');
    if (mongoose.connection.readyState === 1) return;
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 180000,
        maxPoolSize: 20,
    });
};

const withRetry = async (fn) => {
    let attempt = 0;
    while (attempt < MAX_RETRIES) {
        attempt += 1;
        try {
            return await fn();
        } catch (error) {
            if (!isRetryableMongoError(error) || attempt >= MAX_RETRIES) {
                throw error;
            }

            const waitMs = Math.min(15000, 400 * (2 ** attempt)) + Math.floor(Math.random() * 300);
            console.log(`[retry] transient DB error (attempt ${attempt}/${MAX_RETRIES}): ${error.message}`);
            await sleep(waitMs);
            await connectMongo();
        }
    }
    return null;
};

const normalizeRecord = (raw) => {
    const title = safeString(raw.title || raw.name || raw.productName);
    const brand = safeString(raw.brand || 'Unknown');
    const category = safeString(raw.category || 'Misc');
    const description = safeString(raw.description || '');
    const imageCandidate = safeString(raw.image || 'https://via.placeholder.com/600x600?text=Aura+Product');
    const price = Number(safeNumber(raw.price, 0).toFixed(2));
    const stock = Math.max(0, toInt(raw.stock ?? raw.quantity ?? 0, 0));

    if (!title || !category || !Number.isFinite(price) || price < 0) return null;

    const externalId = safeString(raw.externalId || raw.id || hashValue(`${title}|${brand}|${category}|${price}`).slice(0, 24));
    const idCandidate = Number(raw.id);
    const fallbackId = parseInt(hashValue(externalId).slice(0, 8), 16);
    const id = Number.isFinite(idCandidate) ? Math.trunc(idCandidate) : (TARGET_BASE_ID + (fallbackId % 800000000));
    const image = resolveProductImage({
        existingImage: imageCandidate,
        title,
        brand,
        category,
        source: TARGET_SOURCE,
        catalogVersion: TARGET_VERSION,
        externalId,
        id,
    });

    const highlights = Array.isArray(raw.highlights)
        ? raw.highlights.map((entry) => safeString(entry)).filter(Boolean).slice(0, 12)
        : [];

    const doc = {
        id,
        externalId,
        source: TARGET_SOURCE,
        catalogVersion: TARGET_VERSION,
        isPublished: true,
        title,
        titleKey: normalizeTitleKey(title),
        brand,
        category,
        subCategory: safeString(raw.subCategory || ''),
        price,
        originalPrice: Number(safeNumber(raw.originalPrice, price).toFixed(2)),
        discountPercentage: Number(safeNumber(raw.discountPercentage, 0).toFixed(2)),
        rating: Number(Math.min(Math.max(safeNumber(raw.rating, 0), 0), 5).toFixed(1)),
        ratingCount: Math.max(0, toInt(raw.ratingCount, 0)),
        image,
        imageKey: normalizeImageKey(image),
        description,
        highlights,
        stock,
        deliveryTime: safeString(raw.deliveryTime || '3-5 days'),
        warranty: safeString(raw.warranty || ''),
        searchText: buildSearchText({
            title,
            brand,
            category,
            description,
            highlights,
        }),
        updatedFromSyncAt: null,
    };

    doc.ingestHash = hashValue(JSON.stringify({
        id: doc.id,
        externalId: doc.externalId,
        source: doc.source,
        title: doc.title,
        brand: doc.brand,
        category: doc.category,
        price: doc.price,
        originalPrice: doc.originalPrice,
        discountPercentage: doc.discountPercentage,
        rating: doc.rating,
        ratingCount: doc.ratingCount,
        image: doc.image,
        description: doc.description,
        highlights: doc.highlights,
        stock: doc.stock,
        deliveryTime: doc.deliveryTime,
        warranty: doc.warranty,
    }));

    return doc;
};

const getResumeState = async () => {
    await connectMongo();
    const [maxDoc, count] = await Promise.all([
        Product.findOne({ source: TARGET_SOURCE, catalogVersion: TARGET_VERSION })
            .sort({ id: -1 })
            .select('id')
            .lean(),
        Product.countDocuments({ source: TARGET_SOURCE, catalogVersion: TARGET_VERSION }),
    ]);

    const maxId = maxDoc?.id || TARGET_BASE_ID;
    const resumeRow = Math.max(0, maxId - TARGET_BASE_ID);
    return { maxId, count, resumeRow };
};

const auditDatasetSource = async () => {
    const rl = readline.createInterface({
        input: fs.createReadStream(DATA_FILE, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    const sample = [];
    for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            sample.push(JSON.parse(trimmed));
        } catch {
            continue;
        }
        if (sample.length >= DATASET_AUDIT_SAMPLE_SIZE) break;
    }

    const audit = auditCatalogSample(sample);
    console.log('[audit]', JSON.stringify(audit, null, 2));

    if (!ALLOW_SYNTHETIC_DATASET && audit.looksSyntheticDataset) {
        throw new Error(`Dataset audit rejected source: ${Math.round(audit.suspiciousRatio * 100)}% of sampled records look synthetic`);
    }
};

const run = async () => {
    if (!fs.existsSync(DATA_FILE)) {
        throw new Error(`Dataset file not found: ${DATA_FILE}`);
    }

    await auditDatasetSource();

    const { maxId, count, resumeRow } = await getResumeState();
    console.log(`[resume] existing docs=${count.toLocaleString()} maxId=${maxId} resumeRow=${resumeRow.toLocaleString()}`);
    if (count >= TARGET_TOTAL) {
        console.log(`[done] target already reached (${count.toLocaleString()})`);
        return;
    }

    const rl = readline.createInterface({
        input: fs.createReadStream(DATA_FILE, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    let row = 0;
    let processed = 0;
    let upserted = 0;
    let matched = 0;
    let skipped = 0;
    let batch = [];

    const flushBatch = async () => {
        if (batch.length === 0) return;
        const ops = batch.map((doc) => ({
            // Avoid duplicate-path update conflicts in Mongo update document.
            updateOne: (() => {
                const insertDoc = { ...doc };
                delete insertDoc.isPublished;
                return {
                    filter: {
                        externalId: doc.externalId,
                        source: TARGET_SOURCE,
                        catalogVersion: TARGET_VERSION,
                    },
                    update: {
                        $setOnInsert: insertDoc,
                        $set: { isPublished: true },
                    },
                    upsert: true,
                };
            })(),
        }));
        batch = [];

        const result = await withRetry(() => Product.bulkWrite(ops, { ordered: false }));
        upserted += result.upsertedCount || 0;
        matched += result.matchedCount || 0;
    };

    for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        row += 1;
        if (row <= resumeRow) continue;
        if (row > TARGET_TOTAL) break;

        let parsed = null;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            skipped += 1;
            continue;
        }

        const normalized = normalizeRecord(parsed);
        if (!normalized) {
            skipped += 1;
            continue;
        }

        batch.push(normalized);
        processed += 1;

        if (batch.length >= BATCH_SIZE) {
            await flushBatch();
        }

        if (row % 100000 === 0) {
            const currentCount = await Product.countDocuments({ source: TARGET_SOURCE, catalogVersion: TARGET_VERSION });
            console.log(`[progress] row=${row.toLocaleString()} processed=${processed.toLocaleString()} currentCount=${currentCount.toLocaleString()}`);
        }
    }

    await flushBatch();

    const finalCount = await Product.countDocuments({ source: TARGET_SOURCE, catalogVersion: TARGET_VERSION });
    console.log('[result]', JSON.stringify({
        target: TARGET_TOTAL,
        finalCount,
        processed,
        upserted,
        matched,
        skipped,
    }, null, 2));
};

run()
    .catch((error) => {
        console.error('[fatal]', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
