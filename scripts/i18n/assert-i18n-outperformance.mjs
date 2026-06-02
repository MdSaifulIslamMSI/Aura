import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '../..');
const appDir = path.join(repoDir, 'app');
const reviewedDir = path.join(appDir, 'src/i18n/messages/reviewed');

const MIN_SOURCE_KEY_EXPANSION_RATIO = 1.25;
const MIN_LOCALE_MESSAGE_PAIR_EXPANSION_RATIO = 1.35;

const readJson = (relativePath) => {
    const absolutePath = path.join(repoDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Missing required JSON file: ${relativePath}`);
    }
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
};

const parseCoverageCsv = () => {
    const csvPath = path.join(appDir, 'translation-coverage.csv');
    if (!fs.existsSync(csvPath)) {
        throw new Error('Missing app/translation-coverage.csv. Run npm --prefix app run audit:locale first.');
    }

    const [headerLine, ...rows] = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
    const headers = headerLine.split(',');
    const totalKeysIndex = headers.indexOf('total_keys');
    const coveredKeysIndex = headers.indexOf('covered_keys');
    const languageIndex = headers.indexOf('language');

    if (totalKeysIndex === -1 || coveredKeysIndex === -1 || languageIndex === -1) {
        throw new Error('translation-coverage.csv is missing required language/covered_keys/total_keys columns.');
    }

    const records = rows.map((row) => {
        const columns = row.split(',');
        return {
            coveredKeys: Number(columns[coveredKeysIndex]),
            language: columns[languageIndex],
            totalKeys: Number(columns[totalKeysIndex]),
        };
    });

    if (records.length === 0) {
        throw new Error('translation-coverage.csv has no locale rows.');
    }

    const requiredKeys = records[0].totalKeys;
    const requiredLocaleKeyPairs = records.reduce((total, record) => total + record.totalKeys, 0);
    const coveredLocaleKeyPairs = records.reduce((total, record) => total + record.coveredKeys, 0);

    return {
        coveredLocaleKeyPairs,
        localeCount: records.length,
        records,
        requiredKeys,
        requiredLocaleKeyPairs,
    };
};

const summarizeReviewedIcuCatalogs = () => {
    const requiredLocales = readJson('app/src/i18n/quality/requiredLocales.json');
    const sourceMessages = readJson('app/src/i18n/messages/reviewed/en.json');
    const sourceIds = Object.keys(sourceMessages);
    const missing = [];
    const empty = [];
    let coveredLocaleMessagePairs = 0;

    requiredLocales.forEach((locale) => {
        const localePath = path.join(reviewedDir, `${locale}.json`);
        if (!fs.existsSync(localePath)) {
            sourceIds.forEach((id) => missing.push({ id, locale }));
            return;
        }

        const messages = JSON.parse(fs.readFileSync(localePath, 'utf8'));
        sourceIds.forEach((id) => {
            if (!Object.prototype.hasOwnProperty.call(messages, id)) {
                missing.push({ id, locale });
                return;
            }

            if (typeof messages[id] !== 'string' || messages[id].trim() === '') {
                empty.push({ id, locale });
                return;
            }

            coveredLocaleMessagePairs += 1;
        });
    });

    return {
        coveredLocaleMessagePairs,
        emptyLocaleMessagePairs: empty.length,
        requiredLocaleMessagePairs: requiredLocales.length * sourceIds.length,
        requiredLocales: requiredLocales.length,
        sourceKeys: sourceIds.length,
        missingLocaleMessagePairs: missing.length,
    };
};

const sumAffectedPairs = (entries) => entries.reduce((total, entry) => {
    if (Number.isInteger(entry.affectedMessageCount)) return total + entry.affectedMessageCount;

    return total + (Array.isArray(entry.targets)
        ? entry.targets.reduce((targetTotal, target) => {
            if (Number.isInteger(target.affectedMessageCount)) {
                return targetTotal + target.affectedMessageCount;
            }
            return targetTotal + (Array.isArray(target.ids) ? target.ids.length : 0);
        }, 0)
        : 0);
}, 0);

const fail = (message) => {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
};

const legacy = parseCoverageCsv();
const reviewedIcu = summarizeReviewedIcuCatalogs();
const discoveredStableText = readJson('artifacts/i18n/discovered-stable-ui-text.json');
const legacyUsageReport = readJson('artifacts/i18n/legacy-market-pack-usage.json');
const humanReviewQueue = readJson('app/src/i18n/quality/humanReviewQueue.json');
const nativeReviewAudit = readJson('app/src/i18n/quality/nativeReviewAudit.json');

const stableCandidates = Array.isArray(discoveredStableText.candidates)
    ? discoveredStableText.candidates
    : [];
const uncoveredStableCandidates = stableCandidates.filter((candidate) => !candidate.alreadyCoveredByIcu);
const sourceKeyExpansionRatio = legacy.requiredKeys === 0
    ? Infinity
    : reviewedIcu.sourceKeys / legacy.requiredKeys;
const localeMessagePairExpansionRatio = legacy.requiredLocaleKeyPairs === 0
    ? Infinity
    : reviewedIcu.requiredLocaleMessagePairs / legacy.requiredLocaleKeyPairs;
const actionableReviewPairs = sumAffectedPairs(humanReviewQueue);
const nativeReviewPairs = sumAffectedPairs(nativeReviewAudit);
const trackedReviewPairs = actionableReviewPairs + nativeReviewPairs;

if (reviewedIcu.missingLocaleMessagePairs > 0) {
    fail(`Reviewed ICU catalogs are missing ${reviewedIcu.missingLocaleMessagePairs} required locale/message pairs.`);
}

if (reviewedIcu.emptyLocaleMessagePairs > 0) {
    fail(`Reviewed ICU catalogs have ${reviewedIcu.emptyLocaleMessagePairs} empty required locale/message pairs.`);
}

if (uncoveredStableCandidates.length > 0) {
    fail(`Stable UI scanner still has ${uncoveredStableCandidates.length} uncovered candidates.`);
}

if ((legacyUsageReport.summary?.residualLegacyMessageIds || 0) !== 0) {
    fail(`Residual production legacy literal IDs remain: ${legacyUsageReport.summary.residualLegacyMessageIds}.`);
}

if ((legacyUsageReport.summary?.productionLegacyStableFiles || 0) !== 0) {
    fail(`Production files with residual stable legacy literals remain: ${legacyUsageReport.summary.productionLegacyStableFiles}.`);
}

if (sourceKeyExpansionRatio < MIN_SOURCE_KEY_EXPANSION_RATIO) {
    fail(
        `Reviewed ICU source-key expansion is ${sourceKeyExpansionRatio.toFixed(2)}x; `
        + `minimum is ${MIN_SOURCE_KEY_EXPANSION_RATIO.toFixed(2)}x.`
    );
}

if (localeMessagePairExpansionRatio < MIN_LOCALE_MESSAGE_PAIR_EXPANSION_RATIO) {
    fail(
        `Reviewed ICU locale/message expansion is ${localeMessagePairExpansionRatio.toFixed(2)}x; `
        + `minimum is ${MIN_LOCALE_MESSAGE_PAIR_EXPANSION_RATIO.toFixed(2)}x.`
    );
}

console.log('I18n outperformance audit');
console.log(`Legacy runtime layer: ${legacy.requiredKeys} keys across ${legacy.localeCount} locale rows (${legacy.requiredLocaleKeyPairs} required locale/key pairs)`);
console.log(`Reviewed ICU layer: ${reviewedIcu.sourceKeys} keys across ${reviewedIcu.requiredLocales} locales (${reviewedIcu.requiredLocaleMessagePairs} required locale/message pairs)`);
console.log(`Source-key expansion: ${sourceKeyExpansionRatio.toFixed(2)}x (minimum ${MIN_SOURCE_KEY_EXPANSION_RATIO.toFixed(2)}x)`);
console.log(`Locale/message expansion: ${localeMessagePairExpansionRatio.toFixed(2)}x (minimum ${MIN_LOCALE_MESSAGE_PAIR_EXPANSION_RATIO.toFixed(2)}x)`);
console.log(`Stable UI scanner: ${stableCandidates.length} candidates, ${uncoveredStableCandidates.length} uncovered`);
console.log(`Production legacy stable literals: ${legacyUsageReport.summary?.residualLegacyMessageIds || 0} IDs in ${legacyUsageReport.summary?.productionLegacyStableFiles || 0} files`);
console.log(`Tracked human/native review pairs: ${trackedReviewPairs} (${actionableReviewPairs} actionable, ${nativeReviewPairs} native audit)`);

if (process.exitCode) {
    process.exit(process.exitCode);
}

console.log('PASS: new ICU localization system materially outperforms the legacy runtime audit layer.');
