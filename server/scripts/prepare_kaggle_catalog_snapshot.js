require('dotenv').config();

const { prepareKaggleCatalogSnapshot } = require('../services/kaggleCatalogService');

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

const run = async () => {
    const args = parseArgs(process.argv.slice(2));
    const result = await prepareKaggleCatalogSnapshot({
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

    console.log(JSON.stringify({
        dataset: result.dataset,
        dataFilePath: result.dataFilePath,
        snapshotPath: result.snapshotPath,
        manifestPath: result.manifestPath,
        recordCount: result.manifest.recordCount,
        stats: result.stats,
    }, null, 2));
};

run().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
});
