require('dotenv').config();

const mongoose = require('mongoose');
const crypto = require('crypto');
const Product = require('../models/Product');
const SystemState = require('../models/SystemState');
const { createCatalogImportJob, processCatalogImportJobById } = require('../services/catalogService');
const { DEFAULT_TOTAL, buildDemoRecord, generateDemoCatalogSnapshot } = require('../services/demoCatalogSnapshotService');

const DEFAULT_SYSTEM_KEY = 'singleton';
const SHOULD_ACTIVATE = String(process.env.DEMO_CATALOG_ACTIVATE || 'true').toLowerCase() !== 'false';
const DIRECT_BATCH_SIZE = Math.max(100, Number(process.env.DEMO_CATALOG_BATCH_SIZE || 1000));
const DIRECT_TARGET_VERSION = process.env.DEMO_CATALOG_VERSION || 'demo-catalog-100k';

const hashValue = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const isCollectionQuotaError = (error) => String(error?.message || '').toLowerCase().includes('cannot create a new collection');

const ensureMongo = async () => {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
    if (mongoose.connection.readyState === 1) return;
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 180000,
        maxPoolSize: 20,
    });
};

const activateDemoCatalogVersion = async ({ catalogVersion }) => {
    if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
        throw new Error('Refusing to activate demo catalog in production');
    }

    const state = await SystemState.findOneAndUpdate(
        { key: DEFAULT_SYSTEM_KEY },
        { $setOnInsert: { key: DEFAULT_SYSTEM_KEY } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    const previousVersion = state.activeCatalogVersion || 'legacy-v1';

    await Product.updateMany(
        { catalogVersion: { $ne: catalogVersion } },
        { $set: { isPublished: false } }
    );
    await Product.updateMany(
        { catalogVersion },
        { $set: { isPublished: true } }
    );

    state.previousCatalogVersion = previousVersion === catalogVersion ? (state.previousCatalogVersion || '') : previousVersion;
    state.activeCatalogVersion = catalogVersion;
    state.lastSwitchAt = new Date();
    state.catalogLastImportAt = new Date();
    await state.save();

    return {
        publishedVersion: catalogVersion,
        previousVersion,
        switchedAt: state.lastSwitchAt,
    };
};

const activateDemoCatalogVersionWithoutSystemState = async ({ catalogVersion }) => {
    if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
        throw new Error('Refusing to activate demo catalog in production');
    }

    await Product.updateMany(
        { catalogVersion: { $ne: catalogVersion } },
        { $set: { isPublished: false } }
    );
    await Product.updateMany(
        { catalogVersion },
        { $set: { isPublished: true } }
    );

    return {
        publishedVersion: catalogVersion,
        previousVersion: null,
        switchedAt: new Date(),
    };
};

const buildDirectProductDoc = ({ globalIndex, catalogVersion, sourceRef, manifest }) => {
    const record = buildDemoRecord({ globalIndex, catalogVersion });
    const checkedAt = new Date();
    return {
        id: record.id,
        externalId: record.externalId,
        source: 'batch',
        catalogVersion,
        isPublished: false,
        title: record.title,
        titleKey: Product.normalizeTitleKey(record.title),
        brand: record.brand,
        category: record.category,
        subCategory: record.subCategory,
        price: record.price,
        originalPrice: record.originalPrice,
        discountPercentage: record.discountPercentage,
        rating: record.rating,
        ratingCount: record.ratingCount,
        image: record.image,
        imageKey: Product.normalizeImageKey(record.image),
        description: record.description,
        highlights: record.highlights,
        specifications: record.specifications,
        stock: record.stock,
        deliveryTime: record.deliveryTime,
        warranty: record.warranty,
        searchText: [
            record.title,
            record.brand,
            record.category,
            record.description,
            ...record.highlights,
            ...record.specifications.map((entry) => `${entry.key} ${entry.value}`),
        ].join(' | '),
        provenance: {
            sourceName: manifest.providerName,
            sourceType: 'dev_seed',
            sourceRef,
            trustTier: 'unverified',
            datasetClass: 'mixed',
            feedVersion: manifest.feedVersion,
            schemaVersion: manifest.schemaVersion,
            manifestSha256: manifest.sha256,
            observedAt: new Date(manifest.exportTimestamp),
            ingestedAt: checkedAt,
            imageSourceType: 'unknown',
        },
        contentQuality: {
            completenessScore: 100,
            specCount: Array.isArray(record.specifications) ? record.specifications.length : 0,
            highlightCount: Array.isArray(record.highlights) ? record.highlights.length : 0,
            hasDescription: true,
            hasSpecifications: true,
            hasBrand: true,
            hasImage: true,
            hasWarranty: Boolean(record.warranty),
            syntheticScore: 0,
            syntheticRejected: false,
            publishReady: false,
            issues: ['dev_seed_catalog'],
        },
        publishGate: {
            status: 'dev_only',
            reason: 'dev_test_catalog_only',
            checkedAt,
        },
        ingestHash: hashValue(JSON.stringify({
            title: record.title,
            brand: record.brand,
            category: record.category,
            price: record.price,
            originalPrice: record.originalPrice,
            discountPercentage: record.discountPercentage,
            rating: record.rating,
            ratingCount: record.ratingCount,
            image: record.image,
            description: record.description,
            highlights: record.highlights,
            specifications: record.specifications,
            stock: record.stock,
            deliveryTime: record.deliveryTime,
            warranty: record.warranty,
            catalogVersion,
        })),
        updatedFromSyncAt: null,
    };
};

const directSeedDemoCatalog = async ({ snapshot, total = DEFAULT_TOTAL }) => {
    const catalogVersion = `${DIRECT_TARGET_VERSION}-${Date.now()}`;
    const normalizedTotal = Math.max(1, Number(total) || DEFAULT_TOTAL);

    for (let offset = 0; offset < normalizedTotal; offset += DIRECT_BATCH_SIZE) {
        const upper = Math.min(offset + DIRECT_BATCH_SIZE, normalizedTotal);
        const ops = [];

        for (let globalIndex = offset; globalIndex < upper; globalIndex += 1) {
            const doc = buildDirectProductDoc({
                globalIndex,
                catalogVersion,
                sourceRef: snapshot.sourceRef,
                manifest: snapshot.manifest,
            });

            ops.push({
                updateOne: {
                    filter: {
                        externalId: doc.externalId,
                        source: doc.source,
                        catalogVersion: doc.catalogVersion,
                    },
                    update: { $set: doc },
                    upsert: true,
                },
            });
        }

        await Product.bulkWrite(ops, { ordered: false });

        if (upper % 10000 === 0 || upper === normalizedTotal) {
            console.log(`[demo-catalog:direct] upserted ${upper}/${normalizedTotal}`);
        }
    }

    let activation;
    try {
        activation = await activateDemoCatalogVersion({ catalogVersion });
    } catch (error) {
        if (!isCollectionQuotaError(error)) throw error;
        activation = await activateDemoCatalogVersionWithoutSystemState({ catalogVersion });
    }

    const publishedCount = await Product.countDocuments({ catalogVersion, isPublished: true });
    return {
        catalogVersion,
        publishedCount,
        activation,
        totals: {
            totalRows: normalizedTotal,
            inserted: publishedCount,
            updated: 0,
            skipped: 0,
            failed: 0,
        },
        publishGateStatus: 'dev_only',
        publishGateReason: 'dev_test_catalog_cannot_be_published',
    };
};

const run = async () => {
    await ensureMongo();

    const snapshot = await generateDemoCatalogSnapshot();
    console.log(`[demo-catalog] generated ${snapshot.total.toLocaleString()} rows at ${snapshot.sourceRef}`);

    try {
        const job = await createCatalogImportJob({
            sourceType: 'jsonl',
            sourceRef: snapshot.sourceRef,
            manifestRef: snapshot.manifestRef,
            mode: 'batch',
            initiatedBy: 'demo_catalog_seed_script',
            idempotencyKey: `demo-catalog-${snapshot.fileStem}`,
            requestId: `demo-catalog-${Date.now()}`,
        });

        const processed = await processCatalogImportJobById(job.jobId);
        console.log(JSON.stringify({
            jobId: processed.jobId,
            status: processed.status,
            catalogVersion: processed.catalogVersion,
            totals: processed.totals,
            publishGateStatus: processed.publishGateStatus,
            publishGateReason: processed.publishGateReason,
            qualitySummary: processed.qualitySummary,
        }, null, 2));

        if (!['completed', 'completed_with_errors'].includes(processed.status)) {
            throw new Error(`Unexpected import job status: ${processed.status}`);
        }
        if (Number(processed?.totals?.failed || 0) > 0) {
            throw new Error(`Demo catalog import completed with ${processed.totals.failed} failed rows`);
        }
        if (processed.publishGateStatus !== 'dev_only') {
            throw new Error(`Expected demo catalog to remain dev_only, got ${processed.publishGateStatus || 'unknown'}`);
        }

        if (!SHOULD_ACTIVATE) {
            console.log('Demo catalog activation skipped. Set DEMO_CATALOG_ACTIVATE=true to make it the active non-production catalog.');
            return;
        }

        const activation = await activateDemoCatalogVersion({
            catalogVersion: processed.catalogVersion,
        });

        console.log(JSON.stringify({
            ...activation,
            note: 'Synthetic demo catalog activated for non-production only.',
        }, null, 2));
    } catch (error) {
        if (!isCollectionQuotaError(error)) throw error;
        console.log('[demo-catalog] import job collections unavailable, falling back to direct product seeding');
        const directResult = await directSeedDemoCatalog({
            snapshot,
            total: snapshot.total,
        });
        console.log(JSON.stringify({
            ...directResult,
            note: 'Synthetic demo catalog seeded directly into products and activated for non-production only.',
        }, null, 2));
    }
};

run()
    .catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
