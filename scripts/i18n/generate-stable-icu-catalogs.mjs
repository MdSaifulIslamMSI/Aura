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
const { parse: parseSource } = appRequire('@babel/parser');
const traverseModule = appRequire('@babel/traverse');
const traverse = traverseModule.default || traverseModule;
const reviewedDir = path.join(sourceDir, 'i18n/messages/reviewed');
const qualityDir = path.join(sourceDir, 'i18n/quality');
const generatedDescriptorPath = path.join(sourceDir, 'i18n/messages/stableUiMessages.js');
const criticalMessagesPath = path.join(sourceDir, 'i18n/messages/criticalMessages.js');
const localeManifestPath = path.join(qualityDir, 'localeManifest.json');
const queuePath = path.join(qualityDir, 'humanReviewQueue.json');
const nativeReviewAuditPath = path.join(qualityDir, 'nativeReviewAudit.json');
const queueDocPath = path.join(repoDir, 'docs/localization-human-review-queue.md');
const overridesPath = path.join(repoDir, 'scripts/i18n/stable-ui-message-overrides.json');
const brandTermsPath = path.join(sourceDir, 'i18n/glossary/brand-terms.json');
const forbiddenTransliterationsPath = path.join(sourceDir, 'i18n/glossary/forbidden-transliterations.json');
const reviewedLocales = [
    'en',
    'bn',
    'hi',
    'te',
    'mr',
    'ur',
    'gu',
    'pa',
    'ml',
    'kn',
    'or',
    'as',
    'sa',
    'es',
    'fr',
    'de',
    'ar',
    'ja',
    'pt',
    'zh',
];
const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
const localeManifest = JSON.parse(fs.readFileSync(localeManifestPath, 'utf8'));
const brandTerms = JSON.parse(fs.readFileSync(brandTermsPath, 'utf8'));
const forbiddenTransliterations = JSON.parse(fs.readFileSync(forbiddenTransliterationsPath, 'utf8'));
const inventory = await collectLegacyMigrationInventory();
const marketConfig = await import(pathToFileURL(path.join(sourceDir, 'config/marketConfig.js')).href);

await marketConfig.ensureAllMarketMessagesLoaded();

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const existingCatalogs = Object.fromEntries(reviewedLocales.map((locale) => {
    const localePath = path.join(reviewedDir, `${locale}.json`);
    return [
        locale,
        fs.existsSync(localePath) ? readJson(localePath) : {},
    ];
}));
const criticalMessageIds = [
    ...fs.readFileSync(criticalMessagesPath, 'utf8').matchAll(/\bid:\s*['"]([^'"]+)['"]/g),
].map((match) => match[1]);
const reviewedFoundationIds = new Set(criticalMessageIds);
const referencesById = new Map();
const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const SKIPPED_DESCRIPTOR_DIRS = new Set(['node_modules', 'dist', 'coverage', 'test-results']);

const walkSourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
        return SKIPPED_DESCRIPTOR_DIRS.has(entry.name) ? [] : walkSourceFiles(entryPath);
    }
    return CODE_EXTENSIONS.has(path.extname(entry.name)) ? [entryPath] : [];
});

const readStaticString = (node) => {
    if (!node) return '';
    if (node.type === 'StringLiteral') return node.value;
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
        return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('');
    }
    return '';
};

const readObjectProperty = (objectNode, name) => {
    if (objectNode?.type !== 'ObjectExpression') return null;
    const property = objectNode.properties.find((entry) => {
        if (entry.type !== 'ObjectProperty') return false;
        if (entry.key.type === 'Identifier') return entry.key.name === name;
        if (entry.key.type === 'StringLiteral') return entry.key.value === name;
        return false;
    });
    return property?.value || null;
};

const getStaticJsxAttribute = (attributes, name) => {
    const attribute = attributes.find((entry) => (
        entry.type === 'JSXAttribute'
        && entry.name.type === 'JSXIdentifier'
        && entry.name.name === name
    ));
    if (!attribute?.value) return '';
    if (attribute.value.type === 'StringLiteral') return attribute.value.value;
    if (attribute.value.type === 'JSXExpressionContainer') return readStaticString(attribute.value.expression);
    return '';
};

const isFormatMessageCall = (callee) => {
    if (callee.type === 'Identifier') return callee.name === 'formatMessage';
    return (
        callee.type === 'MemberExpression'
        && !callee.computed
        && callee.property.type === 'Identifier'
        && callee.property.name === 'formatMessage'
    );
};

const collectFormatJsSourceMessages = () => {
    const messages = {};

    walkSourceFiles(sourceDir).forEach((filePath) => {
        const source = fs.readFileSync(filePath, 'utf8');
        let ast;
        try {
            ast = parseSource(source, {
                errorRecovery: true,
                plugins: [
                    'jsx',
                    'typescript',
                    'classProperties',
                    'classPrivateProperties',
                    'classPrivateMethods',
                    'decorators-legacy',
                    'dynamicImport',
                    'importMeta',
                    'topLevelAwait',
                ],
                sourceFilename: path.relative(repoDir, filePath).replace(/\\/g, '/'),
                sourceType: 'unambiguous',
            });
        } catch {
            return;
        }

        const collectDescriptorObject = (descriptorNode) => {
            const id = readStaticString(readObjectProperty(descriptorNode, 'id'));
            const defaultMessage = readStaticString(readObjectProperty(descriptorNode, 'defaultMessage'));
            if (id && defaultMessage) messages[id] = defaultMessage;
        };

        traverse(ast, {
            CallExpression(callPath) {
                const { node } = callPath;
                if (isFormatMessageCall(node.callee)) {
                    collectDescriptorObject(node.arguments[0]);
                    return;
                }
                if (node.callee.type !== 'Identifier') return;
                if (node.callee.name === 'defineMessage') {
                    collectDescriptorObject(node.arguments[0]);
                    return;
                }
                if (node.callee.name !== 'defineMessages') return;
                const messagesObject = node.arguments[0];
                if (messagesObject?.type !== 'ObjectExpression') return;
                messagesObject.properties.forEach((property) => {
                    if (property.type !== 'ObjectProperty') return;
                    collectDescriptorObject(property.value);
                });
            },
            JSXOpeningElement(openPath) {
                const { node } = openPath;
                if (node.name.type !== 'JSXIdentifier' || node.name.name !== 'FormattedMessage') return;
                const id = getStaticJsxAttribute(node.attributes, 'id');
                const defaultMessage = getStaticJsxAttribute(node.attributes, 'defaultMessage');
                if (id && defaultMessage) messages[id] = defaultMessage;
            },
        });
    });

    return messages;
};

inventory.productionStableReferences.forEach((reference) => {
    const references = referencesById.get(reference.id) || [];
    references.push(reference);
    referencesById.set(reference.id, references);
});

const stableIds = [...referencesById.keys()].sort();
const stableIdSet = new Set(stableIds);
const extractedSourceMessages = collectFormatJsSourceMessages();
const conflicts = [];
const sourceMessages = {
    ...extractedSourceMessages,
    ...Object.fromEntries(
    [...reviewedFoundationIds]
        .filter((id) => existingCatalogs.en[id])
        .map((id) => [id, existingCatalogs.en[id]])
    ),
};

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

const reviewWorkItems = [];
const catalogs = { en: sourceMessages };

const enqueue = ({ id, locale, message, reason, risk }) => {
    reviewWorkItems.push({
        id,
        locale,
        message,
        reason,
        risk,
        sourceMessage: sourceMessages[id] || '',
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

const getRiskForId = (id) => {
    const references = referencesById.get(id) || [];
    if (references.length === 0) {
        if (/^(auth|checkout|payment|admin|order|support)\./.test(id)) return 'high';
        if (/^(nav|product|profile|search|status|trust|voice)\./.test(id)) return 'medium';
        return 'low';
    }

    return references.some(({ file }) => (
        inventory.fileRecords.find((record) => record.file === file)?.risk === 'high'
    )) ? 'high' : references.some(({ file }) => (
        inventory.fileRecords.find((record) => record.file === file)?.risk === 'medium'
    )) ? 'medium' : 'low';
};

const resolveLocaleMessage = ({ id, locale, risk, sourceAst, sourceMessage }) => {
    const existingMessage = existingCatalogs[locale][id];
    if (existingMessage) {
        try {
            const existingAst = parse(existingMessage);
            if (isStructurallySame(sourceAst, existingAst).success) {
                if (existingMessage === sourceMessage) {
                    const legacyTemplate = marketConfig.getMessageTemplate(locale, id);
                    const candidate = convertLegacyTemplateToIcu(legacyTemplate);
                    if (candidate && candidate !== sourceMessage) {
                        try {
                            const candidateAst = parse(candidate);
                            if (
                                isStructurallySame(sourceAst, candidateAst).success
                                && !findCandidateGlossaryIssue(sourceMessage, candidate)
                            ) {
                                enqueue({
                                    id,
                                    locale,
                                    message: candidate,
                                    reason: reviewedFoundationIds.has(id)
                                        ? 'foundation-pack-promotion-needs-human-review'
                                        : 'legacy-pack-promotion-needs-human-review',
                                    risk,
                                });
                                return candidate;
                            }
                        } catch {
                            // Keep the existing English fallback queued below.
                        }
                    }
                    enqueue({
                        id,
                        locale,
                        message: sourceMessage,
                        reason: 'reviewed-catalog-english-fallback-needs-human-review',
                        risk,
                    });
                } else if (stableIdSet.has(id)) {
                    enqueue({
                        id,
                        locale,
                        message: existingMessage,
                        reason: 'legacy-pack-promotion-needs-human-review',
                        risk,
                    });
                } else if (localeManifest[locale]?.reviewStatus?.includes('queued')) {
                    enqueue({
                        id,
                        locale,
                        message: existingMessage,
                        reason: 'foundation-pack-promotion-needs-human-review',
                        risk,
                    });
                }
                return existingMessage;
            }
        } catch {
            // Fall through to the market-pack promotion path and queue the fallback reason there.
        }
    }

    const legacyTemplate = marketConfig.getMessageTemplate(locale, id);
    const candidate = convertLegacyTemplateToIcu(legacyTemplate);
    if (!candidate) {
        enqueue({
            id,
            locale,
            message: sourceMessage,
            reason: reviewedFoundationIds.has(id)
                ? 'missing-foundation-locale-uses-english-fallback'
                : 'missing-legacy-locale-uses-english-fallback',
            risk,
        });
        return sourceMessage;
    }

    let candidateAst;
    try {
        candidateAst = parse(candidate);
    } catch {
        enqueue({
            id,
            locale,
            message: sourceMessage,
            reason: reviewedFoundationIds.has(id)
                ? 'invalid-foundation-icu-uses-english-fallback'
                : 'invalid-legacy-icu-uses-english-fallback',
            risk,
        });
        return sourceMessage;
    }

    if (!isStructurallySame(sourceAst, candidateAst).success) {
        enqueue({
            id,
            locale,
            message: sourceMessage,
            reason: reviewedFoundationIds.has(id)
                ? 'foundation-placeholder-mismatch-uses-english-fallback'
                : 'legacy-placeholder-mismatch-uses-english-fallback',
            risk,
        });
        return sourceMessage;
    }

    const glossaryIssue = findCandidateGlossaryIssue(sourceMessage, candidate);
    if (glossaryIssue) {
        enqueue({
            id,
            locale,
            message: sourceMessage,
            reason: glossaryIssue,
            risk,
        });
        return sourceMessage;
    }

    enqueue({
        id,
        locale,
        message: candidate,
        reason: candidate === sourceMessage
            ? 'exact-english-fallback-needs-human-review'
            : reviewedFoundationIds.has(id)
                ? 'foundation-pack-promotion-needs-human-review'
                : 'legacy-pack-promotion-needs-human-review',
        risk,
    });
    return candidate;
};

const localeCatalogIds = [...new Set([
    ...Object.keys(sourceMessages),
])].sort();

reviewedLocales.filter((locale) => locale !== 'en').forEach((locale) => {
    const localeMessages = {};

    localeCatalogIds.forEach((id) => {
        const sourceMessage = sourceMessages[id];
        const sourceAst = parse(sourceMessage);
        const risk = getRiskForId(id);

        localeMessages[id] = resolveLocaleMessage({
            id,
            locale,
            risk,
            sourceAst,
            sourceMessage,
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

const riskOrder = { high: 0, medium: 1, low: 2 };
const promotionReasons = new Set([
    'legacy-pack-promotion-needs-human-review',
    'foundation-pack-promotion-needs-human-review',
]);
const createGroupedReviewUnits = (items) => {
    const groups = new Map();
    items.forEach((entry) => {
        const key = [
            entry.reason,
            entry.sourceMessage,
        ].join('\u0000');
        const group = groups.get(key) || {
            affectedMessageCount: 0,
            reason: entry.reason,
            risk: entry.risk,
            sourceMessage: entry.sourceMessage,
            targets: [],
        };
        let target = group.targets.find((candidate) => (
            candidate.locale === entry.locale && candidate.message === entry.message
        ));
        if (!target) {
            target = {
                affectedMessageCount: 0,
                ids: [],
                locale: entry.locale,
                message: entry.message,
                risk: entry.risk,
            };
            group.targets.push(target);
        }
        target.affectedMessageCount += 1;
        target.ids.push(entry.id);
        if (riskOrder[entry.risk] < riskOrder[target.risk]) {
            target.risk = entry.risk;
        }
        group.affectedMessageCount += 1;
        if (riskOrder[entry.risk] < riskOrder[group.risk]) {
            group.risk = entry.risk;
        }
        groups.set(key, group);
    });

    return [...groups.values()]
        .map((group) => ({
            ...group,
            targetCount: group.targets.length,
            targets: group.targets
                .map((target) => ({
                    ...target,
                    ids: target.ids.sort((left, right) => left.localeCompare(right)),
                }))
                .sort((left, right) => (
                    riskOrder[left.risk] - riskOrder[right.risk]
                    || left.locale.localeCompare(right.locale)
                    || left.message.localeCompare(right.message)
                )),
        }))
        .sort((left, right) => (
            riskOrder[left.risk] - riskOrder[right.risk]
            || left.reason.localeCompare(right.reason)
            || left.sourceMessage.localeCompare(right.sourceMessage)
        ));
};

const actionableReviewItems = reviewWorkItems.filter((entry) => !promotionReasons.has(entry.reason));
const nativeAuditItems = reviewWorkItems.filter((entry) => promotionReasons.has(entry.reason));
const sortedQueue = createGroupedReviewUnits(actionableReviewItems);
const nativeReviewAudit = createGroupedReviewUnits(nativeAuditItems);
const writeCompactJson = (filePath, value) => {
    fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
};

writeCompactJson(queuePath, sortedQueue);
writeCompactJson(nativeReviewAuditPath, nativeReviewAudit);

const summarizeGroupedUnits = (units) => units.reduce((summary, entry) => {
    summary.entryCount += 1;
    summary.affectedMessageCount += entry.affectedMessageCount;
    summary.byRisk[entry.risk] += 1;
    summary.byReason[entry.reason] = (summary.byReason[entry.reason] || 0) + 1;
    summary.affectedByRisk[entry.risk] += entry.affectedMessageCount;
    summary.affectedByReason[entry.reason] = (summary.affectedByReason[entry.reason] || 0) + entry.affectedMessageCount;
    entry.targets.forEach((target) => {
        summary.byLocale[target.locale] = (summary.byLocale[target.locale] || 0) + 1;
        summary.affectedByLocale[target.locale] = (summary.affectedByLocale[target.locale] || 0) + target.affectedMessageCount;
    });
    return summary;
}, {
    affectedByLocale: {},
    affectedByReason: {},
    affectedByRisk: { high: 0, medium: 0, low: 0 },
    affectedMessageCount: 0,
    byLocale: {},
    byReason: {},
    byRisk: { high: 0, medium: 0, low: 0 },
    entryCount: 0,
});

const queueSummary = summarizeGroupedUnits(sortedQueue);
const nativeAuditSummary = summarizeGroupedUnits(nativeReviewAudit);
const originalWorkItemCount = reviewWorkItems.length;

fs.writeFileSync(queueDocPath, [
    '# Localization Human Review Queue',
    '',
    'The ICU migration promotes stable UI copy into reviewed catalogs without sending it through runtime translation. This file separates true action items from native-review audit coverage so the queue stays usable instead of becoming a raw per-id spreadsheet.',
    '',
    '## Summary',
    '',
    `- Stable ICU message IDs: ${stableIds.length}`,
    `- Former raw review rows: ${originalWorkItemCount}`,
    `- Actionable grouped queue entries: ${queueSummary.entryCount}`,
    `- Actionable affected locale-message pairs: ${queueSummary.affectedMessageCount}`,
    `- Native-review audit grouped entries: ${nativeAuditSummary.entryCount}`,
    `- Native-review audit affected locale-message pairs: ${nativeAuditSummary.affectedMessageCount}`,
    `- High-risk actionable entries: ${queueSummary.byRisk.high} (${queueSummary.affectedByRisk.high} affected pairs)`,
    `- Medium-risk actionable entries: ${queueSummary.byRisk.medium} (${queueSummary.affectedByRisk.medium} affected pairs)`,
    `- Low-risk actionable entries: ${queueSummary.byRisk.low} (${queueSummary.affectedByRisk.low} affected pairs)`,
    '',
    '## Actionable Queue By Locale',
    '',
    ...Object.entries(queueSummary.byLocale).map(([locale, count]) => `- \`${locale}\`: ${count} grouped entries / ${queueSummary.affectedByLocale[locale]} affected pairs`),
    '',
    '## Actionable Queue By Reason',
    '',
    ...Object.entries(queueSummary.byReason).map(([reason, count]) => `- \`${reason}\`: ${count} grouped entries / ${queueSummary.affectedByReason[reason]} affected pairs`),
    '',
    '## Native Review Audit',
    '',
    'Structurally valid legacy/foundation promotions are tracked separately because they need native linguistic signoff but do not block catalog integrity or English-leakage QA by themselves.',
    '',
    ...Object.entries(nativeAuditSummary.byLocale).map(([locale, count]) => `- \`${locale}\`: ${count} grouped entries / ${nativeAuditSummary.affectedByLocale[locale]} affected pairs`),
    '',
    '## Review Order',
    '',
    '1. Resolve actionable high-risk English fallbacks, placeholder mismatches, glossary issues, and invalid ICU first.',
    '2. Resolve actionable medium-risk navigation, discovery, listing, search, filters, and voice copy next.',
    '3. Resolve low-risk actionable fallbacks last.',
    '4. Use `nativeReviewAudit.json` for locale-by-locale native signoff of valid machine/legacy promotions.',
    '',
    'Machine-readable actionable queue: `app/src/i18n/quality/humanReviewQueue.json`.',
    '',
    'Machine-readable native review audit: `app/src/i18n/quality/nativeReviewAudit.json`.',
    '',
].join('\n'), 'utf8');

console.log(`Generated stable ICU descriptors: ${stableIds.length}`);
console.log(`Generated reviewed ICU catalog messages: ${Object.keys(sourceMessages).length}`);
console.log(`Former raw human review rows: ${originalWorkItemCount}`);
console.log(`Generated actionable human review queue entries: ${sortedQueue.length}`);
console.log(`Actionable affected locale-message pairs: ${queueSummary.affectedMessageCount}`);
console.log(`Generated native review audit entries: ${nativeReviewAudit.length}`);
console.log(`Native review audit affected locale-message pairs: ${nativeAuditSummary.affectedMessageCount}`);
console.log(`Queue: ${path.relative(repoDir, queuePath).replace(/\\/g, '/')}`);
