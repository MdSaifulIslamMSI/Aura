require('dotenv').config();

const mongoose = require('mongoose');
const { importKaggleCatalog } = require('../services/externalCatalogService');
const {
    createCatalogImportJob,
    processCatalogImportJobById,
    publishCatalogVersion,
} = require('../services/catalogService');

const parseArgs = (argv = []) => {
    const options = {};

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith('--')) continue;

        const key = token.slice(2);
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            options[key] = true;
            continue;
        }
        options[key] = next;
        index += 1;
    }

    return options;
};

const parseJsonOption = (value, fallback) => {
    if (!value) return fallback;
    try {
        return JSON.parse(value);
    } catch (error) {
        throw new Error(`Invalid JSON option: ${error.message}`);
    }
};

const connectMongo = async () => {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI missing in environment');
    }
    if (mongoose.connection.readyState === 1) return;
    await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 180000,
        maxPoolSize: 10,
    });
};

const run = async () => {
    const args = parseArgs(process.argv.slice(2));
    await connectMongo();

    const prepared = await prepareKaggleCatalogSnapshot({
        dataset: args.dataset || process.env.KAGGLE_DATASET || '',
        datasetFile: args.file || process.env.KAGGLE_DATASET_FILE || '',
        sourceFile: args['source-file'] || process.env.KAGGLE_SOURCE_FILE || '',
        archivePath: args.archive || process.env.KAGGLE_ARCHIVE_PATH || '',
        limit: Number(args.limit || process.env.KAGGLE_IMPORT_LIMIT || 0),
        imageBaseUrl: args['image-base-url'] || process.env.KAGGLE_IMAGE_BASE_URL || '',
        fieldMapping: parseJsonOption(args['field-map'] || process.env.KAGGLE_FIELD_MAP || '', {}),
        specFields: parseJsonOption(args['spec-fields'] || process.env.KAGGLE_SPEC_FIELDS || '', []),
        strict: String(args.strict ?? process.env.KAGGLE_STRICT ?? 'true').trim().toLowerCase() !== 'false',
        force: Boolean(args.force),
        providerName: args['provider-name'] || process.env.KAGGLE_PROVIDER_NAME || '',
    });

    const job = await createCatalogImportJob({
        sourceType: 'jsonl',
        sourceRef: prepared.snapshotPath,
        manifestRef: prepared.manifestPath,
        mode: 'batch',
        initiatedBy: `kaggle:${prepared.dataset}`,
        idempotencyKey: `kaggle:${prepared.dataset}:${prepared.manifest.feedVersion}`,
    });

    const processed = await processCatalogImportJobById(job.jobId);
    let published = null;

    if (args.publish || String(process.env.KAGGLE_IMPORT_PUBLISH || 'false').trim().toLowerCase() === 'true') {
        published = await publishCatalogVersion(job.jobId);
    }

    console.log(JSON.stringify({
        dataset: prepared.dataset,
        snapshotPath: prepared.snapshotPath,
        manifestPath: prepared.manifestPath,
        preparedStats: prepared.stats,
        importJob: {
            jobId: job.jobId,
            catalogVersion: job.catalogVersion,
        },
        processed,
        published,
    }, null, 2));
};

run()
    .catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.connection.close().catch(() => {});
    });
