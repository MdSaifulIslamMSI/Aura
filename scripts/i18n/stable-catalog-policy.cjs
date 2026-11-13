const crypto = require('node:crypto');
const path = require('node:path');

const NON_SIGNOFF_LOCALES = new Set(['en', 'en-XA']);
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

const normalizePath = (filePath) => {
    const normalized = path.resolve(filePath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

const shouldCollectFormatJsSourceFile = ({ filePath, generatedDescriptorPath }) => (
    normalizePath(filePath) !== normalizePath(generatedDescriptorPath)
);

const isStaleEnglishFallback = ({
    existingMessage,
    previousSourceMessage,
    sourceMessage,
}) => Boolean(
    existingMessage
    && previousSourceMessage
    && previousSourceMessage !== sourceMessage
    && existingMessage === previousSourceMessage
);

const getPromotionReviewReason = ({ isStableMessage }) => (
    isStableMessage
        ? 'legacy-pack-promotion-needs-human-review'
        : 'foundation-pack-promotion-needs-human-review'
);

/** Compute canonical SHA-256 hex digest for hash-bound translation signoffs. */
const computeMessageDigest = (message = '') => crypto
    .createHash('sha256')
    .update(String(message ?? ''), 'utf8')
    .digest('hex');

const normalizeSignoffLedger = (rawLedger = {}) => {
    const source = rawLedger && typeof rawLedger === 'object' ? rawLedger : {};
    const rawApprovals = source.approvals && typeof source.approvals === 'object' ? source.approvals : {};
    const approvals = {};
    for (const [locale, entries] of Object.entries(rawApprovals)) {
        if (!entries || typeof entries !== 'object') continue;
        approvals[locale] = entries;
    }
    return {
        version: Number.isInteger(source.version) ? source.version : 1,
        description: typeof source.description === 'string' ? source.description : '',
        approvals,
    };
};

/**
 * Validate that a native-reviewer signoff is structurally valid and still bound
 * to the exact current English source and translated catalog strings.
 */
const validateSignoffRecord = ({
    record,
    locale,
    sourceMessage,
    translatedMessage,
} = {}) => {
    if (!record || typeof record !== 'object') {
        return { valid: false, reason: 'missing-record' };
    }
    if (!locale || NON_SIGNOFF_LOCALES.has(locale)) {
        return { valid: false, reason: 'non-target-locale' };
    }
    if (typeof record.reviewer !== 'string' || record.reviewer.trim().length < 2) {
        return { valid: false, reason: 'invalid-reviewer' };
    }
    if (typeof record.reviewedAt !== 'string' || Number.isNaN(Date.parse(record.reviewedAt))) {
        return { valid: false, reason: 'invalid-reviewed-at' };
    }
    if (typeof sourceMessage !== 'string' || typeof translatedMessage !== 'string' || !translatedMessage.trim()) {
        return { valid: false, reason: 'empty-message' };
    }
    if (translatedMessage === sourceMessage) {
        return { valid: false, reason: 'exact-english-fallback' };
    }
    const expectedSourceHash = computeMessageDigest(sourceMessage);
    if (!SHA256_HEX_RE.test(String(record.sourceSha256 || '')) || record.sourceSha256 !== expectedSourceHash) {
        return { valid: false, reason: 'source-digest-mismatch' };
    }
    const expectedTranslationHash = computeMessageDigest(translatedMessage);
    if (!SHA256_HEX_RE.test(String(record.translationSha256 || '')) || record.translationSha256 !== expectedTranslationHash) {
        return { valid: false, reason: 'translation-digest-mismatch' };
    }
    return { valid: true, reason: 'approved' };
};

const isNativeSignoffApproved = (params) => validateSignoffRecord(params).valid;

const createSignoffRecord = ({
    sourceMessage,
    translatedMessage,
    reviewer,
    reviewedAt = new Date().toISOString(),
}) => {
    const cleanReviewer = String(reviewer || '').trim();
    if (cleanReviewer.length < 2) {
        throw new Error('Native signoff requires a non-empty reviewer identifier (>= 2 characters).');
    }
    const parsedTime = Date.parse(reviewedAt);
    if (Number.isNaN(parsedTime)) {
        throw new Error(`Invalid reviewedAt timestamp: ${reviewedAt}`);
    }
    if (typeof sourceMessage !== 'string' || typeof translatedMessage !== 'string' || !translatedMessage.trim()) {
        throw new Error('Cannot sign off missing or empty source/translation strings.');
    }
    if (translatedMessage === sourceMessage) {
        throw new Error('Cannot sign off an untranslated string that is identical to English source.');
    }
    return {
        sourceSha256: computeMessageDigest(sourceMessage),
        translationSha256: computeMessageDigest(translatedMessage),
        reviewer: cleanReviewer,
        reviewedAt: new Date(parsedTime).toISOString(),
    };
};

const auditSignoffLedger = ({
    ledger,
    sourceCatalog = {},
    catalogsByLocale = {},
    requiredLocales = [],
} = {}) => {
    const normalized = normalizeSignoffLedger(ledger);
    const allowedLocales = new Set(requiredLocales);
    const validEntries = [];
    const staleEntries = [];
    const invalidEntries = [];

    for (const [locale, entries] of Object.entries(normalized.approvals)) {
        if (NON_SIGNOFF_LOCALES.has(locale) || (allowedLocales.size > 0 && !allowedLocales.has(locale))) {
            Object.keys(entries).forEach((id) => invalidEntries.push({ locale, id, reason: 'unknown-or-non-target-locale' }));
            continue;
        }
        const catalog = catalogsByLocale[locale] || {};
        for (const [id, record] of Object.entries(entries)) {
            if (!Object.prototype.hasOwnProperty.call(sourceCatalog, id)) {
                invalidEntries.push({ locale, id, reason: 'unknown-source-id' });
                continue;
            }
            const verdict = validateSignoffRecord({
                record,
                locale,
                sourceMessage: sourceCatalog[id],
                translatedMessage: catalog[id],
            });
            if (verdict.valid) {
                validEntries.push({ locale, id, reviewer: record.reviewer, reviewedAt: record.reviewedAt });
            } else if (verdict.reason === 'source-digest-mismatch' || verdict.reason === 'translation-digest-mismatch') {
                staleEntries.push({ locale, id, reason: verdict.reason });
            } else {
                invalidEntries.push({ locale, id, reason: verdict.reason });
            }
        }
    }

    return { validEntries, staleEntries, invalidEntries };
};

module.exports = {
    auditSignoffLedger,
    computeMessageDigest,
    createSignoffRecord,
    getPromotionReviewReason,
    isNativeSignoffApproved,
    isStaleEnglishFallback,
    normalizeSignoffLedger,
    shouldCollectFormatJsSourceFile,
    validateSignoffRecord,
};
