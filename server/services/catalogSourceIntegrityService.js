const SYNTHETIC_IMAGE_HOST_PATTERNS = [
    /picsum\.photos/i,
    /via\.placeholder\.com/i,
    /placehold\.co/i,
    /dummyimage\.com/i,
    /loremflickr\.com/i,
];

const SYNTHETIC_TITLE_PATTERNS = [
    /\bproduct\s+\d+$/i,
    /^(nimbus|zenova|orion|novagear|vertex|pulse|quantum|astra|luma|auratech)\b.+\bproduct\s+\d+$/i,
];

const SYNTHETIC_DESCRIPTION_PATTERNS = [
    /^high quality .+ item \d+ from .+\.$/i,
];

const SYNTHETIC_EXTERNAL_ID_PATTERNS = [
    /^aura-sku-\d+$/i,
];

const normalize = (value) => String(value || '').trim();

const matchesAny = (value, patterns) => patterns.some((pattern) => pattern.test(value));

const analyzeCatalogRecord = (record = {}) => {
    const title = normalize(record.title || record.name || record.productName);
    const description = normalize(record.description);
    const image = normalize(record.image || (Array.isArray(record.images) ? record.images[0] : ''));
    const externalId = normalize(record.externalId || record.id);

    const flags = {
        syntheticImage: matchesAny(image, SYNTHETIC_IMAGE_HOST_PATTERNS),
        syntheticTitle: matchesAny(title, SYNTHETIC_TITLE_PATTERNS),
        syntheticDescription: matchesAny(description, SYNTHETIC_DESCRIPTION_PATTERNS),
        syntheticExternalId: matchesAny(externalId, SYNTHETIC_EXTERNAL_ID_PATTERNS),
    };

    const reasons = Object.entries(flags)
        .filter(([, isFlagged]) => isFlagged)
        .map(([key]) => key);

    return {
        flags,
        reasons,
        suspiciousScore: reasons.length,
        looksSynthetic: reasons.length >= 2,
    };
};

const auditCatalogSample = (records = []) => {
    const totals = {
        sampled: 0,
        syntheticImage: 0,
        syntheticTitle: 0,
        syntheticDescription: 0,
        syntheticExternalId: 0,
        looksSynthetic: 0,
    };

    const examples = [];

    for (const record of records) {
        const result = analyzeCatalogRecord(record);
        totals.sampled += 1;

        Object.entries(result.flags).forEach(([key, flagged]) => {
            if (flagged) totals[key] += 1;
        });

        if (result.looksSynthetic) {
            totals.looksSynthetic += 1;
            if (examples.length < 5) {
                examples.push({
                    title: normalize(record.title || record.name || record.productName),
                    image: normalize(record.image || (Array.isArray(record.images) ? record.images[0] : '')),
                    externalId: normalize(record.externalId || record.id),
                    reasons: result.reasons,
                });
            }
        }
    }

    const sampled = totals.sampled || 1;
    const suspiciousRatio = totals.looksSynthetic / sampled;

    return {
        totals,
        suspiciousRatio,
        looksSyntheticDataset: suspiciousRatio >= 0.3,
        examples,
    };
};

module.exports = {
    analyzeCatalogRecord,
    auditCatalogSample,
};
