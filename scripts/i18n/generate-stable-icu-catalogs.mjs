import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
    appDir,
    collectLegacyMigrationInventory,
    convertLegacyTemplateToIcu,
    repoDir,
    sourceDir,
} from './legacy-migration-lib.mjs';

const appRequire = createRequire(path.join(appDir, 'package.json'));
const { isStructurallySame, parse } = appRequire('@formatjs/icu-messageformat-parser');
const reviewedDir = path.join(sourceDir, 'i18n/messages/reviewed');
const qualityDir = path.join(sourceDir, 'i18n/quality');
const generatedDescriptorPath = path.join(sourceDir, 'i18n/messages/stableUiMessages.js');
const criticalMessagesPath = path.join(sourceDir, 'i18n/messages/criticalMessages.js');
const queuePath = path.join(qualityDir, 'humanReviewQueue.json');
const queueDocPath = path.join(repoDir, 'docs/localization-human-review-queue.md');
const overridesPath = path.join(repoDir, 'scripts/i18n/stable-ui-message-overrides.json');
const brandTermsPath = path.join(sourceDir, 'i18n/glossary/brand-terms.json');
const forbiddenTransliterationsPath = path.join(sourceDir, 'i18n/glossary/forbidden-transliterations.json');
const reviewedLocales = ['en', 'hi', 'bn', 'ur', 'ar'];
const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
const brandTerms = JSON.parse(fs.readFileSync(brandTermsPath, 'utf8'));
const forbiddenTransliterations = JSON.parse(fs.readFileSync(forbiddenTransliterationsPath, 'utf8'));
const inventory = await collectLegacyMigrationInventory();
const marketConfig = await import(pathToFileURL(path.join(sourceDir, 'config/marketConfig.js')).href);

await marketConfig.ensureAllMarketMessagesLoaded();

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const existingCatalogs = Object.fromEntries(reviewedLocales.map((locale) => [
    locale,
    readJson(path.join(reviewedDir, `${locale}.json`)),
]));
const criticalMessageIds = [
    ...fs.readFileSync(criticalMessagesPath, 'utf8').matchAll(/\bid:\s*['"]([^'"]+)['"]/g),
].map((match) => match[1]);
const reviewedFoundationIds = new Set(criticalMessageIds);
const referencesById = new Map();

inventory.productionStableReferences.forEach((reference) => {
    const references = referencesById.get(reference.id) || [];
    references.push(reference);
    referencesById.set(reference.id, references);
});

const stableIds = [...referencesById.keys()].sort();
const conflicts = [];
const sourceMessages = Object.fromEntries(
    [...reviewedFoundationIds]
        .filter((id) => existingCatalogs.en[id])
        .map((id) => [id, existingCatalogs.en[id]])
);

const assertValidIcu = (id, message) => {
    try {
        return parse(message);
    } catch (error) {
        throw new Error(`Invalid source ICU for ${id}: ${error.message}`);
    }
};

stableIds.forEach((id) => {
    const references = referencesById.get(id);
    const candidates = [...new Set(references.map(({ icuDefaultMessage }) => icuDefaultMessage))];
    const existingMessage = reviewedFoundationIds.has(id) ? existingCatalogs.en[id] : '';
    const override = overrides[id];

    if (candidates.length > 1 && !existingMessage && !override) {
        conflicts.push({
            candidates,
            id,
            references: references.map(({ file, line }) => `${file}:${line}`),
        });
        return;
    }

    const message = existingMessage || override || candidates[0];
    assertValidIcu(id, message);
    sourceMessages[id] = message;
});

if (conflicts.length > 0) {
    throw new Error(`Stable ICU generation needs ${conflicts.length} conflict override(s): ${JSON.stringify(conflicts, null, 2)}`);
}

const queue = [];
const catalogs = { en: sourceMessages };

const enqueue = ({ id, locale, message, reason, risk }) => {
    queue.push({
        id,
        locale,
        message,
        reason,
        risk,
    });
};

const findCandidateGlossaryIssue = (sourceMessage, candidate) => {
    const missingBrandTerm = Object.entries(brandTerms).find(([term, rule]) => (
        rule.doNotTranslate && sourceMessage.includes(term) && !candidate.includes(term)
    ));
    if (missingBrandTerm) return 'brand-term-corruption-uses-english-fallback';

    const forbiddenTransliteration = Object.values(forbiddenTransliterations)
        .flat()
        .find((translation) => candidate.includes(translation));
    if (forbiddenTransliteration) return 'forbidden-transliteration-uses-english-fallback';

    return '';
};

reviewedLocales.filter((locale) => locale !== 'en').forEach((locale) => {
    const localeMessages = Object.fromEntries(
        [...reviewedFoundationIds]
            .filter((id) => existingCatalogs[locale][id])
            .map((id) => [id, existingCatalogs[locale][id]])
    );

    stableIds.forEach((id) => {
        const sourceMessage = sourceMessages[id];
        const sourceAst = parse(sourceMessage);
        const risk = referencesById.get(id).some(({ file }) => (
            inventory.fileRecords.find((record) => record.file === file)?.risk === 'high'
        )) ? 'high' : referencesById.get(id).some(({ file }) => (
            inventory.fileRecords.find((record) => record.file === file)?.risk === 'medium'
        )) ? 'medium' : 'low';

        if (reviewedFoundationIds.has(id) && existingCatalogs[locale][id]) {
            localeMessages[id] = existingCatalogs[locale][id];
            return;
        }

        const legacyTemplate = marketConfig.getMessageTemplate(locale, id);
        const candidate = convertLegacyTemplateToIcu(legacyTemplate);
        if (!candidate) {
            localeMessages[id] = sourceMessage;
            enqueue({
                id,
                locale,
                message: sourceMessage,
                reason: 'missing-legacy-locale-uses-english-fallback',
                risk,
            });
            return;
        }

        let candidateAst;
        try {
            candidateAst = parse(candidate);
        } catch {
            localeMessages[id] = sourceMessage;
            enqueue({
                id,
                locale,
                message: sourceMessage,
                reason: 'invalid-legacy-icu-uses-english-fallback',
                risk,
            });
            return;
        }

        if (!isStructurallySame(sourceAst, candidateAst).success) {
            localeMessages[id] = sourceMessage;
            enqueue({
                id,
                locale,
                message: sourceMessage,
                reason: 'legacy-placeholder-mismatch-uses-english-fallback',
                risk,
            });
            return;
        }

        const glossaryIssue = findCandidateGlossaryIssue(sourceMessage, candidate);
        if (glossaryIssue) {
            localeMessages[id] = sourceMessage;
            enqueue({
                id,
                locale,
                message: sourceMessage,
                reason: glossaryIssue,
                risk,
            });
            return;
        }

        localeMessages[id] = candidate;
        enqueue({
            id,
            locale,
            message: candidate,
            reason: candidate === sourceMessage
                ? 'exact-english-fallback-needs-human-review'
                : 'legacy-pack-promotion-needs-human-review',
            risk,
        });
    });

    catalogs[locale] = localeMessages;
});

const descriptorEntries = stableIds.map((id) => [
    `    ${JSON.stringify(id)}: {`,
    `        id: ${JSON.stringify(id)},`,
    `        defaultMessage: ${JSON.stringify(sourceMessages[id])},`,
    "        description: 'Stable UI message migrated from legacy market-pack lookup. Review context in the localization migration inventory.',",
    '    },',
].join('\n'));

fs.writeFileSync(generatedDescriptorPath, [
    '// Generated by scripts/i18n/generate-stable-icu-catalogs.mjs. Do not edit by hand.',
    '/* eslint-disable formatjs/prefer-full-sentence */',
    "import { defineMessages } from 'react-intl';",
    '',
    'export const stableUiMessages = defineMessages({',
    ...descriptorEntries,
    '});',
    '',
].join('\n'), 'utf8');

Object.entries(catalogs).forEach(([locale, messages]) => {
    fs.writeFileSync(
        path.join(reviewedDir, `${locale}.json`),
        `${JSON.stringify(Object.fromEntries(Object.entries(messages).sort(([left], [right]) => left.localeCompare(right))), null, 2)}\n`,
        'utf8'
    );
});

const sortedQueue = queue.sort((left, right) => (
    ({ high: 0, medium: 1, low: 2 })[left.risk] - ({ high: 0, medium: 1, low: 2 })[right.risk]
    || left.locale.localeCompare(right.locale)
    || left.id.localeCompare(right.id)
));
fs.writeFileSync(queuePath, `${JSON.stringify(sortedQueue, null, 2)}\n`, 'utf8');

const queueSummary = sortedQueue.reduce((summary, entry) => {
    summary.byRisk[entry.risk] += 1;
    summary.byReason[entry.reason] = (summary.byReason[entry.reason] || 0) + 1;
    summary.byLocale[entry.locale] = (summary.byLocale[entry.locale] || 0) + 1;
    return summary;
}, {
    byLocale: {},
    byReason: {},
    byRisk: { high: 0, medium: 0, low: 0 },
});

fs.writeFileSync(queueDocPath, [
    '# Localization Human Review Queue',
    '',
    'The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. Existing foundation entries keep their prior reviewed status. Newly promoted locale entries remain queued for human linguistic review.',
    '',
    '## Summary',
    '',
    `- Stable ICU message IDs: ${stableIds.length}`,
    `- Queue entries: ${sortedQueue.length}`,
    `- High-risk queue entries: ${queueSummary.byRisk.high}`,
    `- Medium-risk queue entries: ${queueSummary.byRisk.medium}`,
    `- Low-risk queue entries: ${queueSummary.byRisk.low}`,
    '',
    '## By Locale',
    '',
    ...Object.entries(queueSummary.byLocale).map(([locale, count]) => `- \`${locale}\`: ${count}`),
    '',
    '## By Reason',
    '',
    ...Object.entries(queueSummary.byReason).map(([reason, count]) => `- \`${reason}\`: ${count}`),
    '',
    '## Review Order',
    '',
    '1. Review high-risk checkout, cart, payment, authentication, seller, and support copy first.',
    '2. Review medium-risk navigation, discovery, listing, search, filters, and voice copy next.',
    '3. Review low-risk operational and secondary UI copy last.',
    '4. Resolve English fallbacks and placeholder mismatches before marking a locale batch reviewed.',
    '',
    'The full machine-readable queue is committed at `app/src/i18n/quality/humanReviewQueue.json`.',
    '',
].join('\n'), 'utf8');

console.log(`Generated stable ICU descriptors: ${stableIds.length}`);
console.log(`Generated reviewed ICU catalog messages: ${Object.keys(sourceMessages).length}`);
console.log(`Generated human review queue entries: ${sortedQueue.length}`);
console.log(`Queue: ${path.relative(repoDir, queuePath).replace(/\\/g, '/')}`);
