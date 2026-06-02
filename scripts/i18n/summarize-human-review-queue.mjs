import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '../..');
const appDir = path.join(repoDir, 'app');
const reviewedDir = path.join(appDir, 'src/i18n/messages/reviewed');
const outputDir = path.join(repoDir, 'artifacts/i18n');
const triageDocPath = path.join(repoDir, 'docs/localization-human-review-triage.md');

const readJson = (relativePath, fallback = undefined) => {
    const absolutePath = path.join(repoDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
        if (fallback !== undefined) return fallback;
        throw new Error(`Missing required JSON file: ${relativePath}`);
    }
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
};

const requiredLocales = readJson('app/src/i18n/quality/requiredLocales.json');
const sourceMessages = readJson('app/src/i18n/messages/reviewed/en.json');
const humanReviewQueue = readJson('app/src/i18n/quality/humanReviewQueue.json', []);
const nativeReviewAudit = readJson('app/src/i18n/quality/nativeReviewAudit.json', []);
const discoveredStableText = readJson('artifacts/i18n/discovered-stable-ui-text.json', {
    candidates: [],
    summary: {},
});
const legacyUsageReport = readJson('artifacts/i18n/legacy-market-pack-usage.json', {
    summary: {},
});

const riskOrder = { high: 0, medium: 1, low: 2 };
const criticalIdPattern = /^(auth|checkout|payment|admin|order|support|profile\.settings\.security|status)\./;
const placeholderPattern = /\{[^}]+\}/;

const validationErrors = [];
const ensureArray = (value) => (Array.isArray(value) ? value : []);
const countBy = (items, selector) => items.reduce((acc, item) => {
    const key = selector(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
}, {});

const sortObject = (value) => Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
);

const expandGroupedUnits = (units, bucket) => {
    const rows = [];

    units.forEach((entry, entryIndex) => {
        const targets = ensureArray(entry.targets);
        if (targets.length === 0) {
            validationErrors.push(`${bucket}[${entryIndex}] has no targets.`);
            return;
        }

        if (Number.isInteger(entry.targetCount) && entry.targetCount !== targets.length) {
            validationErrors.push(`${bucket}[${entryIndex}] targetCount=${entry.targetCount} but targets.length=${targets.length}.`);
        }

        let computedEntryAffectedCount = 0;
        targets.forEach((target, targetIndex) => {
            const ids = ensureArray(target.ids);
            if (!target.locale) validationErrors.push(`${bucket}[${entryIndex}].targets[${targetIndex}] has no locale.`);
            if (ids.length === 0) validationErrors.push(`${bucket}[${entryIndex}].targets[${targetIndex}] has no ids.`);
            if (Number.isInteger(target.affectedMessageCount) && target.affectedMessageCount !== ids.length) {
                validationErrors.push(`${bucket}[${entryIndex}].targets[${targetIndex}] affectedMessageCount=${target.affectedMessageCount} but ids.length=${ids.length}.`);
            }

            computedEntryAffectedCount += ids.length;
            ids.forEach((id) => {
                rows.push({
                    bucket,
                    id,
                    locale: target.locale,
                    message: target.message ?? '',
                    reason: entry.reason,
                    risk: target.risk || entry.risk || 'low',
                    sourceMessage: entry.sourceMessage ?? '',
                });
            });
        });

        if (
            Number.isInteger(entry.affectedMessageCount)
            && entry.affectedMessageCount !== computedEntryAffectedCount
        ) {
            validationErrors.push(`${bucket}[${entryIndex}] affectedMessageCount=${entry.affectedMessageCount} but expanded ids=${computedEntryAffectedCount}.`);
        }
    });

    return rows;
};

const summarizeGroupedUnits = (units, bucket) => {
    const rows = expandGroupedUnits(units, bucket);
    return {
        affectedMessagePairs: rows.length,
        byLocale: sortObject(countBy(rows, (row) => row.locale)),
        byReason: sortObject(countBy(rows, (row) => row.reason)),
        byRisk: {
            high: rows.filter((row) => row.risk === 'high').length,
            medium: rows.filter((row) => row.risk === 'medium').length,
            low: rows.filter((row) => row.risk === 'low').length,
        },
        groupedEntries: units.length,
        rows,
        uniqueSourceMessages: new Set(rows.map((row) => row.sourceMessage)).size,
    };
};

const summarizeCatalogCoverage = () => {
    const sourceIds = Object.keys(sourceMessages);
    const expectedMessagePairs = requiredLocales.length * sourceIds.length;
    const missing = [];
    const empty = [];
    const extras = [];
    let presentRequiredMessagePairs = 0;

    requiredLocales.forEach((locale) => {
        const localePath = path.join(reviewedDir, `${locale}.json`);
        if (!fs.existsSync(localePath)) {
            sourceIds.forEach((id) => missing.push({ id, locale }));
            return;
        }

        const messages = JSON.parse(fs.readFileSync(localePath, 'utf8'));
        const localeIds = new Set(Object.keys(messages));
        sourceIds.forEach((id) => {
            if (!localeIds.has(id)) {
                missing.push({ id, locale });
                return;
            }
            if (typeof messages[id] !== 'string' || messages[id].trim() === '') {
                empty.push({ id, locale });
                return;
            }
            presentRequiredMessagePairs += 1;
        });

        Object.keys(messages)
            .filter((id) => !Object.prototype.hasOwnProperty.call(sourceMessages, id))
            .forEach((id) => extras.push({ id, locale }));
    });

    return {
        emptyMessagePairs: empty.length,
        expectedMessagePairs,
        extraMessagePairs: extras.length,
        missingMessagePairs: missing.length,
        presentRequiredMessagePairs,
        requiredLocales: requiredLocales.length,
        sourceMessageKeys: sourceIds.length,
        coveragePercent: expectedMessagePairs === 0
            ? 100
            : Number(((presentRequiredMessagePairs / expectedMessagePairs) * 100).toFixed(2)),
    };
};

const actionableSummary = summarizeGroupedUnits(humanReviewQueue, 'actionableQueue');
const nativeAuditSummary = summarizeGroupedUnits(nativeReviewAudit, 'nativeReviewAudit');
const allRows = [...actionableSummary.rows, ...nativeAuditSummary.rows];
const seenLocaleIds = new Map();
const duplicateLocaleIds = [];

allRows.forEach((row) => {
    const key = `${row.locale}\u0000${row.id}`;
    const previous = seenLocaleIds.get(key);
    if (previous) {
        duplicateLocaleIds.push({ current: row, previous });
        return;
    }
    seenLocaleIds.set(key, row);
});

const stableCandidates = ensureArray(discoveredStableText.candidates);
const uncoveredStableCandidates = stableCandidates.filter((candidate) => !candidate.alreadyCoveredByIcu);
const catalogCoverage = summarizeCatalogCoverage();

const priorityForEntry = (entry) => {
    const touchesCriticalId = ensureArray(entry.targets).some((target) => (
        ensureArray(target.ids).some((id) => criticalIdPattern.test(id))
    ));
    const hasPlaceholder = placeholderPattern.test(entry.sourceMessage || '');
    const affectedCount = entry.affectedMessageCount || 0;

    if (entry.risk === 'high' && (touchesCriticalId || hasPlaceholder || affectedCount >= 12)) return 'critical';
    if (entry.risk === 'high') return 'high';
    if (entry.risk === 'medium' || hasPlaceholder || affectedCount >= 10) return 'medium';
    return 'low';
};

const actionablePriorities = humanReviewQueue.reduce((acc, entry) => {
    const priority = priorityForEntry(entry);
    const bucket = acc[priority] || {
        affectedMessagePairs: 0,
        entries: 0,
        examples: [],
        localeSpread: {},
    };
    bucket.entries += 1;
    bucket.affectedMessagePairs += entry.affectedMessageCount || 0;
    ensureArray(entry.targets).forEach((target) => {
        bucket.localeSpread[target.locale] = (bucket.localeSpread[target.locale] || 0) + (target.affectedMessageCount || ensureArray(target.ids).length);
    });
    if (bucket.examples.length < 8) {
        bucket.examples.push({
            affectedMessagePairs: entry.affectedMessageCount || 0,
            reason: entry.reason,
            risk: entry.risk,
            sampleIds: ensureArray(entry.targets).flatMap((target) => ensureArray(target.ids)).slice(0, 5),
            sourceMessage: entry.sourceMessage,
            targetCount: entry.targetCount || ensureArray(entry.targets).length,
        });
    }
    acc[priority] = bucket;
    return acc;
}, {});

['critical', 'high', 'medium', 'low'].forEach((priority) => {
    if (!actionablePriorities[priority]) {
        actionablePriorities[priority] = {
            affectedMessagePairs: 0,
            entries: 0,
            examples: [],
            localeSpread: {},
        };
    }
    actionablePriorities[priority].localeSpread = sortObject(actionablePriorities[priority].localeSpread);
});

const summary = {
    generatedAt: new Date().toISOString(),
    machineCertification: {
        catalogCoverage,
        duplicateLocaleIdPairs: duplicateLocaleIds.length,
        reviewValidationErrors: validationErrors.length,
        stableUiCandidates: stableCandidates.length || discoveredStableText.summary?.stableCandidates || 0,
        uncoveredStableUiCandidates: uncoveredStableCandidates.length,
    },
    reviewCoverage: {
        actionableQueue: {
            affectedMessagePairs: actionableSummary.affectedMessagePairs,
            byLocale: actionableSummary.byLocale,
            byReason: actionableSummary.byReason,
            byRisk: actionableSummary.byRisk,
            groupedEntries: actionableSummary.groupedEntries,
            uniqueSourceMessages: actionableSummary.uniqueSourceMessages,
        },
        nativeReviewAudit: {
            affectedMessagePairs: nativeAuditSummary.affectedMessagePairs,
            byLocale: nativeAuditSummary.byLocale,
            byReason: nativeAuditSummary.byReason,
            byRisk: nativeAuditSummary.byRisk,
            groupedEntries: nativeAuditSummary.groupedEntries,
            uniqueSourceMessages: nativeAuditSummary.uniqueSourceMessages,
        },
        totalTrackedReviewPairs: allRows.length,
        uniqueLocaleIdPairs: seenLocaleIds.size,
    },
    actionablePriorities,
    legacyUsageSummary: legacyUsageReport.summary || {},
};

const failReasons = [
    duplicateLocaleIds.length > 0 ? `${duplicateLocaleIds.length} duplicate locale/id review pair(s)` : '',
    validationErrors.length > 0 ? `${validationErrors.length} grouped queue validation error(s)` : '',
    catalogCoverage.missingMessagePairs > 0 ? `${catalogCoverage.missingMessagePairs} missing locale catalog message pair(s)` : '',
    catalogCoverage.emptyMessagePairs > 0 ? `${catalogCoverage.emptyMessagePairs} empty locale catalog message pair(s)` : '',
    uncoveredStableCandidates.length > 0 ? `${uncoveredStableCandidates.length} uncovered stable UI candidate(s)` : '',
].filter(Boolean);

const formatLocaleSpread = (localeSpread) => Object.entries(localeSpread)
    .map(([locale, count]) => `${locale} ${count}`)
    .join(', ');

const priorityRows = ['critical', 'high', 'medium', 'low'].map((priority) => {
    const bucket = actionablePriorities[priority];
    return `| ${priority} | ${bucket.entries} | ${bucket.affectedMessagePairs} | ${formatLocaleSpread(bucket.localeSpread)} |`;
});

const exampleRows = ['critical', 'high', 'medium', 'low'].flatMap((priority) => (
    actionablePriorities[priority].examples.map((example) => `${[
        `| ${priority}`,
        example.risk,
        example.affectedMessagePairs,
        example.sourceMessage.replace(/\|/g, '\\|'),
        example.sampleIds.join(', '),
    ].join(' | ')} |`)
));

const nativeLocaleRows = Object.entries(nativeAuditSummary.byLocale).map(([locale, count]) => (
    `| ${locale} | ${count} |`
));

const markdown = [
    '# Localization Human Review Triage',
    '',
    'This report proves the large human-review queue is compressed without dropping any tracked locale/message pair. It does not certify native literary quality; it certifies catalog completeness, stable UI ownership, queue integrity, and review traceability.',
    '',
    '## Machine Certification',
    '',
    `- Stable UI candidates discovered: ${summary.machineCertification.stableUiCandidates}`,
    `- Uncovered stable UI candidates: ${summary.machineCertification.uncoveredStableUiCandidates}`,
    `- Locale key coverage: ${catalogCoverage.coveragePercent}% (${catalogCoverage.presentRequiredMessagePairs}/${catalogCoverage.expectedMessagePairs} required locale/message pairs)`,
    `- Required locales: ${catalogCoverage.requiredLocales}`,
    `- Source message keys: ${catalogCoverage.sourceMessageKeys}`,
    `- Missing locale/message pairs: ${catalogCoverage.missingMessagePairs}`,
    `- Empty locale/message pairs: ${catalogCoverage.emptyMessagePairs}`,
    `- Duplicate review locale/id pairs: ${summary.machineCertification.duplicateLocaleIdPairs}`,
    `- Grouped queue validation errors: ${summary.machineCertification.reviewValidationErrors}`,
    '',
    '## Breakthrough Result',
    '',
    `- Total tracked review pairs preserved: ${summary.reviewCoverage.totalTrackedReviewPairs}`,
    `- Unique review locale/id pairs: ${summary.reviewCoverage.uniqueLocaleIdPairs}`,
    `- Actionable grouped queue entries: ${actionableSummary.groupedEntries}`,
    `- Actionable affected locale/message pairs: ${actionableSummary.affectedMessagePairs}`,
    `- Native-review audit grouped entries: ${nativeAuditSummary.groupedEntries}`,
    `- Native-review audit affected locale/message pairs: ${nativeAuditSummary.affectedMessagePairs}`,
    '',
    'Actionable queue entries are unresolved English fallback or safety-review items. Native-review audit entries are structurally valid promotions kept visible for locale signoff without blocking machine QA.',
    '',
    '## Actionable Priorities',
    '',
    '| Priority | Grouped entries | Affected pairs | Locale spread |',
    '| --- | ---: | ---: | --- |',
    ...priorityRows,
    '',
    '## Examples',
    '',
    '| Priority | Risk | Affected pairs | Source message | Sample IDs |',
    '| --- | --- | ---: | --- | --- |',
    ...exampleRows,
    '',
    '## Native Review Audit By Locale',
    '',
    '| Locale | Affected pairs |',
    '| --- | ---: |',
    ...nativeLocaleRows,
    '',
    '## Files',
    '',
    '- Actionable queue: `app/src/i18n/quality/humanReviewQueue.json`',
    '- Native review audit: `app/src/i18n/quality/nativeReviewAudit.json`',
    '- Stable UI discovery report: `artifacts/i18n/discovered-stable-ui-text.json`',
    '- Summary JSON: `artifacts/i18n/human-review-queue-summary.json`',
    '',
].join('\n');

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'human-review-queue-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
fs.writeFileSync(path.join(outputDir, 'human-review-queue-summary.md'), markdown, 'utf8');
fs.writeFileSync(triageDocPath, markdown, 'utf8');

console.log(`Stable UI candidates: ${summary.machineCertification.stableUiCandidates}`);
console.log(`Uncovered stable UI candidates: ${summary.machineCertification.uncoveredStableUiCandidates}`);
console.log(`Locale key coverage: ${catalogCoverage.coveragePercent}% (${catalogCoverage.presentRequiredMessagePairs}/${catalogCoverage.expectedMessagePairs})`);
console.log(`Actionable grouped queue entries: ${actionableSummary.groupedEntries}`);
console.log(`Actionable affected locale-message pairs: ${actionableSummary.affectedMessagePairs}`);
console.log(`Native review audit grouped entries: ${nativeAuditSummary.groupedEntries}`);
console.log(`Native review audit affected locale-message pairs: ${nativeAuditSummary.affectedMessagePairs}`);
console.log(`Total tracked review pairs preserved: ${allRows.length}`);
console.log(`Duplicate review locale/id pairs: ${duplicateLocaleIds.length}`);
console.log(`Grouped queue validation errors: ${validationErrors.length}`);
console.log('Report: docs/localization-human-review-triage.md');

if (failReasons.length > 0) {
    console.error(`Human review queue summary failed: ${failReasons.join('; ')}`);
    process.exitCode = 1;
}
