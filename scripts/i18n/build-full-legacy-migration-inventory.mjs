import fs from 'node:fs';
import path from 'node:path';
import {
    collectLegacyMigrationInventory,
    outputDir,
} from './legacy-migration-lib.mjs';

const report = await collectLegacyMigrationInventory();
const jsonPath = path.join(outputDir, 'full-legacy-migration-inventory.json');
const markdownPath = path.join(outputDir, 'full-legacy-migration-inventory.md');
const { summary } = report;

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
fs.writeFileSync(markdownPath, [
    '# Complete Legacy ICU Migration Inventory',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    report.note,
    '',
    '## Summary',
    '',
    `- Source files scanned: ${summary.sourceFilesScanned}`,
    `- Tracked files: ${summary.totalTrackedFiles}`,
    `- Production files with stable literal UI copy: ${summary.productionFiles}`,
    `- Production stable literal references: ${summary.productionStableReferences}`,
    `- Unique production stable IDs: ${summary.uniqueProductionStableIds}`,
    `- Dynamic lookup references requiring manual review: ${summary.dynamicLookupReferences}`,
    `- Runtime-content translation files: ${summary.runtimeContentFiles}`,
    `- Legacy pack internal files: ${summary.legacyPackInternalFiles}`,
    `- Test-harness literal references: ${summary.testHarnessReferences}`,
    `- Stable references with no English pack or call-site fallback: ${summary.unresolvedEnglishDefaults}`,
    `- Parse errors: ${summary.parseErrors}`,
    '',
    '## Migration Buckets',
    '',
    '### Stable UI literals',
    '',
    'These production references are eligible for reviewed ICU catalog migration.',
    '',
    '| Risk | File | Stable refs | IDs | Dynamic refs | Signals |',
    '| --- | --- | ---: | ---: | ---: | --- |',
    ...report.fileRecords
        .filter(({ isTestFile, stableLiteralCount }) => !isTestFile && stableLiteralCount > 0)
        .map((record) => {
            const signals = [
                record.usesDynamicRuntimeTranslation ? 'runtime-content-nearby' : '',
                record.importsLegacyPacks ? 'legacy-pack-internal' : '',
            ].filter(Boolean).join(', ') || 'stable-ui';
            return `| ${record.risk} | \`${record.file}\` | ${record.stableLiteralCount} | ${record.messageIdCount} | ${record.dynamicLookupCount} | ${signals} |`;
        }),
    '',
    '### Dynamic lookups',
    '',
    'These computed keys stay outside automatic migration until manually reviewed.',
    '',
    '| File | Line | Reason |',
    '| --- | ---: | --- |',
    ...report.dynamicLookupReferences.map((reference) => (
        `| \`${reference.file}\` | ${reference.line} | ${reference.reason} |`
    )),
    '',
    '### Runtime content translation',
    '',
    'These files intentionally translate user, seller, catalog, chat, support, or other runtime content through the dynamic translation path.',
    '',
    ...report.runtimeContentFiles.map((file) => `- \`${file}\``),
    '',
    '### Legacy pack internals',
    '',
    'These files remain compatibility inputs while stable UI call sites move to ICU catalogs.',
    '',
    ...report.legacyPackInternalFiles.map((file) => `- \`${file}\``),
    '',
    '### Unresolved English defaults',
    '',
    'Any entry here needs a manual English descriptor before migration can be considered complete.',
    '',
    ...report.unresolvedEnglishDefaults.map((reference) => (
        `- \`${reference.file}:${reference.line}\` \`${reference.id}\``
    )),
].join('\n'), 'utf8');

console.log('Complete legacy ICU migration inventory generated.');
console.log(`Stable production IDs: ${summary.uniqueProductionStableIds}`);
console.log(`Dynamic lookups: ${summary.dynamicLookupReferences}`);
console.log(`Unresolved English defaults: ${summary.unresolvedEnglishDefaults}`);
console.log('Report: artifacts/i18n/full-legacy-migration-inventory.md');

if (summary.parseErrors > 0 || summary.unresolvedEnglishDefaults > 0) {
    process.exitCode = 1;
}
