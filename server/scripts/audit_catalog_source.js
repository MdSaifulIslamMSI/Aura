require('dotenv').config();

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { auditCatalogSample } = require('../services/catalogSourceIntegrityService');

const DATA_FILE = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : path.join(__dirname, '..', 'data', 'catalog_1m.jsonl');
const SAMPLE_SIZE = Number(process.env.CATALOG_IMPORT_AUDIT_SAMPLE_SIZE || 1000);

const run = async () => {
    if (!fs.existsSync(DATA_FILE)) {
        throw new Error(`Dataset file not found: ${DATA_FILE}`);
    }

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

        if (sample.length >= SAMPLE_SIZE) break;
    }

    const audit = auditCatalogSample(sample);
    console.log(JSON.stringify({
        file: DATA_FILE,
        sampleSize: sample.length,
        ...audit,
    }, null, 2));

    if (audit.looksSyntheticDataset) {
        process.exitCode = 2;
    }
};

run().catch((error) => {
    console.error('[audit-catalog] failed', error.message);
    process.exitCode = 1;
});
