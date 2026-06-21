require('dotenv').config();

const crypto = require('crypto');
const mongoose = require('mongoose');
const { assertMongoUriContract, buildMongoConnectionOptions } = require('../config/db');
const {
    hydrateOrderMinorUnits,
    hydratePaymentIntentMinorUnits,
} = require('../services/payments/moneyStorage');

const DEFAULT_SAMPLE_LIMIT = 10;
const DEFAULT_BATCH_SIZE = 500;
const MONEY_AUDIT_MAX_TIME_MS = 30000;

const parsePositiveInteger = (value, fallback) => {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const parseLimit = (argv = process.argv.slice(2)) => {
    const limitArg = argv.find((arg) => String(arg || '').startsWith('--limit='));
    if (!limitArg) return 0;
    const parsed = Number.parseInt(limitArg.split('=').slice(1).join('='), 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
};

const shouldApplyBackfill = (argv = process.argv.slice(2)) => argv.includes('--apply');

const clonePlain = (value) => JSON.parse(JSON.stringify(value || {}));

const hashDocumentId = (value) => crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex')
    .slice(0, 16);

const getPath = (value, path) => String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, part) => (current === undefined || current === null ? undefined : current[part]), value);

const hasStoredValue = (value) => value !== undefined && value !== null;

const compareMinorPath = ({ actual, expected, path }) => {
    const expectedValue = getPath(expected, path);
    const actualValue = getPath(actual, path);

    if (expectedValue === null || expectedValue === undefined) {
        return hasStoredValue(actualValue) && actualValue !== null
            ? { path, type: 'mismatch', expectedValue: null }
            : null;
    }

    if (!hasStoredValue(actualValue)) {
        return { path, type: 'missing', expectedValue };
    }

    if (!Number.isSafeInteger(Number(actualValue)) || Number(actualValue) !== Number(expectedValue)) {
        return { path, type: 'mismatch', expectedValue };
    }

    return null;
};

const collectPaymentIntentMinorPaths = () => ([
    'amountMinor',
    'baseAmountMinor',
    'displayAmountMinor',
    'settlementAmountMinor',
    'providerBaseAmountMinor',
]);

const collectOrderMinorPaths = (order = {}) => {
    const paths = [
        'itemsPriceMinor',
        'taxPriceMinor',
        'shippingPriceMinor',
        'totalPriceMinor',
        'baseAmountMinor',
        'displayAmountMinor',
        'settlementAmountMinor',
        'presentmentTotalPriceMinor',
        'couponDiscountMinor',
        'paymentAdjustmentMinor',
        'refundSummary.totalRefundedMinor',
        'refundSummary.presentmentTotalRefundedMinor',
    ];

    (order.orderItems || []).forEach((_item, index) => {
        paths.push(`orderItems.${index}.priceMinor`);
    });
    (order.refundSummary?.refunds || []).forEach((_refund, index) => {
        paths.push(`refundSummary.refunds.${index}.amountMinor`);
        paths.push(`refundSummary.refunds.${index}.settlementAmountMinor`);
        paths.push(`refundSummary.refunds.${index}.presentmentAmountMinor`);
    });
    (order.commandCenter?.refunds || []).forEach((_refund, index) => {
        paths.push(`commandCenter.refunds.${index}.amountMinor`);
    });

    return paths;
};

const compareDocumentMinorFields = ({ collectionName, document }) => {
    const actual = clonePlain(document);
    const expected = clonePlain(document);

    let paths = [];
    if (collectionName === 'paymentintents') {
        hydratePaymentIntentMinorUnits(expected);
        paths = collectPaymentIntentMinorPaths();
    } else if (collectionName === 'orders') {
        hydrateOrderMinorUnits(expected);
        paths = collectOrderMinorPaths(expected);
    } else {
        throw new Error(`Unsupported money minor-unit collection: ${collectionName}`);
    }

    const differences = paths
        .map((path) => compareMinorPath({ actual, expected, path }))
        .filter(Boolean);

    return {
        documentHash: hashDocumentId(document?._id),
        missingPaths: differences
            .filter((entry) => entry.type === 'missing')
            .map((entry) => entry.path),
        mismatchedPaths: differences
            .filter((entry) => entry.type === 'mismatch')
            .map((entry) => entry.path),
        setFields: differences.reduce((acc, entry) => {
            acc[entry.path] = entry.expectedValue;
            return acc;
        }, {}),
    };
};

const summarizeCollectionAudit = ({
    collectionName,
    totalDocuments,
    scannedDocuments,
    differenceResults,
    sampleLimit = DEFAULT_SAMPLE_LIMIT,
    limit = 0,
    appliedDocuments = 0,
    appliedFieldCount = 0,
}) => {
    const documentsWithFindings = differenceResults.filter((entry) => (
        entry.missingPaths.length > 0 || entry.mismatchedPaths.length > 0
    ));
    const missingMinorFieldCount = documentsWithFindings
        .reduce((total, entry) => total + entry.missingPaths.length, 0);
    const mismatchedMinorFieldCount = documentsWithFindings
        .reduce((total, entry) => total + entry.mismatchedPaths.length, 0);

    return {
        collection: collectionName,
        totalDocuments,
        scannedDocuments,
        limited: limit > 0 && scannedDocuments < totalDocuments,
        documentsWithFindings: documentsWithFindings.length,
        missingMinorFieldCount,
        mismatchedMinorFieldCount,
        appliedDocuments,
        appliedFieldCount,
        samples: documentsWithFindings.slice(0, sampleLimit).map((entry) => ({
            documentHash: entry.documentHash,
            missingPaths: entry.missingPaths.slice(0, 20),
            mismatchedPaths: entry.mismatchedPaths.slice(0, 20),
        })),
    };
};

const connectMongo = async () => {
    if (mongoose.connection.readyState === 1) return;

    const uri = assertMongoUriContract(process.env);
    await mongoose.connect(uri, {
        ...buildMongoConnectionOptions(process.env),
        maxPoolSize: 5,
    });
};

const auditCollection = async ({
    db,
    collectionName,
    limit = 0,
    sampleLimit = DEFAULT_SAMPLE_LIMIT,
    apply = false,
}) => {
    const collection = db.collection(collectionName);
    const totalDocuments = await collection.countDocuments({}, { maxTimeMS: MONEY_AUDIT_MAX_TIME_MS });
    const cursor = collection
        .find({}, { maxTimeMS: MONEY_AUDIT_MAX_TIME_MS })
        .batchSize(DEFAULT_BATCH_SIZE);
    if (limit > 0) cursor.limit(limit);

    const differenceResults = [];
    let appliedDocuments = 0;
    let appliedFieldCount = 0;
    let scannedDocuments = 0;
    for await (const document of cursor) {
        scannedDocuments += 1;
        const result = compareDocumentMinorFields({ collectionName, document });
        if (result.missingPaths.length > 0 || result.mismatchedPaths.length > 0) {
            differenceResults.push(result);
            const setFields = result.setFields || {};
            if (apply && Object.keys(setFields).length > 0) {
                const updateResult = await collection.updateOne(
                    { _id: document._id },
                    { $set: setFields }
                );
                if (updateResult.matchedCount === 1) {
                    appliedDocuments += 1;
                    appliedFieldCount += Object.keys(setFields).length;
                }
            }
        }
    }

    return summarizeCollectionAudit({
        collectionName,
        totalDocuments,
        scannedDocuments,
        differenceResults,
        sampleLimit,
        limit,
        appliedDocuments,
        appliedFieldCount,
    });
};

const run = async () => {
    const limit = parseLimit();
    const apply = shouldApplyBackfill();
    const sampleLimit = parsePositiveInteger(process.env.MONEY_MINOR_AUDIT_SAMPLE_LIMIT, DEFAULT_SAMPLE_LIMIT);

    if (apply && limit > 0) {
        throw new Error('Refusing to apply a partial money minor-unit backfill. Rerun without --limit.');
    }
    if (apply && String(process.env.MONEY_MINOR_BACKFILL_APPROVED || '').trim().toLowerCase() !== 'true') {
        throw new Error('Refusing to apply money minor-unit backfill without MONEY_MINOR_BACKFILL_APPROVED=true.');
    }

    await connectMongo();
    const db = mongoose.connection.db;

    const [paymentIntentAudit, orderAudit] = await Promise.all([
        auditCollection({ db, collectionName: 'paymentintents', limit, sampleLimit, apply }),
        auditCollection({ db, collectionName: 'orders', limit, sampleLimit, apply }),
    ]);
    const collectionAudits = [paymentIntentAudit, orderAudit];
    const totalDocumentsWithFindings = collectionAudits
        .reduce((total, audit) => total + audit.documentsWithFindings, 0);
    const findings = [];
    if (totalDocumentsWithFindings > 0) {
        findings.push('Historical documents are missing or disagree with canonical integer minor-unit mirrors; plan an audited backfill before deprecating decimal compatibility fields.');
    }
    if (collectionAudits.some((audit) => audit.limited)) {
        findings.push('Audit used a document limit; rerun without --limit before approving any backfill.');
    }

    console.log(JSON.stringify({
        ok: true,
        mode: apply ? 'apply' : 'read_only',
        database: db.databaseName,
        generatedAt: new Date().toISOString(),
        limit: limit || null,
        collections: collectionAudits,
        totals: {
            scannedDocuments: collectionAudits.reduce((total, audit) => total + audit.scannedDocuments, 0),
            documentsWithFindings: totalDocumentsWithFindings,
            missingMinorFieldCount: collectionAudits.reduce((total, audit) => total + audit.missingMinorFieldCount, 0),
            mismatchedMinorFieldCount: collectionAudits.reduce((total, audit) => total + audit.mismatchedMinorFieldCount, 0),
            appliedDocuments: collectionAudits.reduce((total, audit) => total + audit.appliedDocuments, 0),
            appliedFieldCount: collectionAudits.reduce((total, audit) => total + audit.appliedFieldCount, 0),
        },
        findings,
        note: 'Read-only report. Samples use hashed document ids only; no customer data or raw money values are printed.',
    }, null, 2));
};

module.exports = {
    collectOrderMinorPaths,
    collectPaymentIntentMinorPaths,
    compareDocumentMinorFields,
    compareMinorPath,
    hashDocumentId,
    shouldApplyBackfill,
    summarizeCollectionAudit,
};

if (require.main === module) {
    run()
        .catch((error) => {
            console.error(JSON.stringify({
                ok: false,
                error: String(error?.message || error),
            }, null, 2));
            process.exitCode = 1;
        })
        .finally(async () => {
            await mongoose.connection.close().catch(() => {});
        });
}
