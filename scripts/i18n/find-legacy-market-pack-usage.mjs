import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '../..');
const sourceDir = path.join(repoDir, 'app/src');
const outputDir = path.join(repoDir, 'artifacts/i18n');

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', 'test-results']);
const HIGH_RISK_PREFIXES = [
    'checkout.',
    'cart.',
    'payment.',
    'orders.',
    'order.',
    'auth.',
    'login.',
    'profile.settings.security.',
    'seller.',
    'support.',
];
const MEDIUM_RISK_PREFIXES = [
    'nav.',
    'product.',
    'listing.',
    'filters.',
    'search.',
    'voice.',
];
const ICU_DELEGATED_TRANSLATOR_FILES = new Set([
    'app/src/pages/Login/LoginView.jsx',
    'app/src/pages/Login/loginFlowHelpers.js',
]);

const walkFiles = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.flatMap((entry) => {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return SKIP_DIRS.has(entry.name) ? [] : walkFiles(entryPath);
        }
        return CODE_EXTENSIONS.has(path.extname(entry.name)) ? [entryPath] : [];
    });
};

const classifyRisk = (ids = [], hasDynamicRuntimeUsage = false) => {
    if (ids.some((id) => HIGH_RISK_PREFIXES.some((prefix) => id.startsWith(prefix)))) {
        return 'high';
    }
    if (
        hasDynamicRuntimeUsage
        || ids.some((id) => MEDIUM_RISK_PREFIXES.some((prefix) => id.startsWith(prefix)))
    ) {
        return 'medium';
    }
    return 'low';
};

const collectLegacyUsage = (filePath) => {
    const content = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(repoDir, filePath).replace(/\\/g, '/');
    const messageIds = [];
    const callPattern = /\bt\(\s*['"`]([^'"`]+)['"`]/g;
    let match;

    while ((match = callPattern.exec(content)) !== null) {
        messageIds.push(match[1]);
    }

    const usesMarketContext = /\buseMarket\s*\(/.test(content) || /from ['"]@\/context\/MarketContext['"]/.test(content);
    const usesDynamicRuntimeTranslation = /\buseDynamicTranslations\s*\(/.test(content)
        || /\brequestRuntimeTranslations\s*\(/.test(content)
        || /\bMarketAutoLocalizer\b/.test(content);
    const importsLegacyPacks = /marketMessagePacks|marketMessages\.generated|MARKET_MESSAGE_PACK/.test(content);
    const usesStableIcuHook = /\buseStableIcuMessages\b/.test(content);
    const usesDelegatedStableIcuTranslator = ICU_DELEGATED_TRANSLATOR_FILES.has(relativePath);
    const usesComputedTranslatorLookup = messageIds.some((id) => id.includes('${'))
        || /\bt\(\s*(?!['"`])/.test(content);

    if (
        messageIds.length === 0
        && !usesDynamicRuntimeTranslation
        && !importsLegacyPacks
        && !usesStableIcuHook
        && !usesDelegatedStableIcuTranslator
        && !usesComputedTranslatorLookup
    ) {
        return null;
    }

    const uniqueIds = [...new Set(messageIds.filter((id) => !id.includes('${')))].sort();
    const migratedStableIcuIds = usesStableIcuHook || usesDelegatedStableIcuTranslator ? uniqueIds : [];
    const residualLegacyIds = usesStableIcuHook || usesDelegatedStableIcuTranslator ? [] : uniqueIds;
    return {
        file: relativePath,
        importsLegacyPacks,
        migratedStableIcuIdCount: migratedStableIcuIds.length,
        migratedStableIcuIds,
        residualLegacyIdCount: residualLegacyIds.length,
        residualLegacyIds,
        risk: classifyRisk(residualLegacyIds, usesDynamicRuntimeTranslation),
        usesComputedTranslatorLookup,
        usesDelegatedStableIcuTranslator,
        usesDynamicRuntimeTranslation,
        usesMarketContext,
        usesStableIcuHook,
    };
};

const records = walkFiles(sourceDir)
    .map(collectLegacyUsage)
    .filter(Boolean)
    .sort((left, right) => {
        const riskOrder = { high: 0, medium: 1, low: 2 };
        return riskOrder[left.risk] - riskOrder[right.risk]
            || right.residualLegacyIdCount - left.residualLegacyIdCount
            || right.migratedStableIcuIdCount - left.migratedStableIcuIdCount
            || left.file.localeCompare(right.file);
    });

const summary = records.reduce((acc, record) => {
    acc.totalFiles += 1;
    acc.migratedStableIcuMessageIds += record.migratedStableIcuIdCount;
    acc.residualLegacyMessageIds += record.residualLegacyIdCount;
    acc.byRisk[record.risk] += 1;
    if (record.usesComputedTranslatorLookup) acc.computedTranslatorLookupFiles += 1;
    if (record.usesDelegatedStableIcuTranslator) acc.delegatedStableIcuFiles += 1;
    if (record.usesDynamicRuntimeTranslation) acc.dynamicRuntimeFiles += 1;
    if (record.importsLegacyPacks) acc.legacyPackImportFiles += 1;
    if (record.usesStableIcuHook) acc.stableIcuHookFiles += 1;
    if (
        record.residualLegacyIdCount > 0
        && !/\.(test|spec)\.[jt]sx?$/i.test(record.file)
        && !record.importsLegacyPacks
    ) {
        acc.productionLegacyStableFiles += 1;
    }
    return acc;
}, {
    byRisk: { high: 0, medium: 0, low: 0 },
    computedTranslatorLookupFiles: 0,
    delegatedStableIcuFiles: 0,
    dynamicRuntimeFiles: 0,
    legacyPackImportFiles: 0,
    migratedStableIcuMessageIds: 0,
    productionLegacyStableFiles: 0,
    residualLegacyMessageIds: 0,
    stableIcuHookFiles: 0,
    totalFiles: 0,
});

const report = {
    generatedAt: new Date().toISOString(),
    note: 'Compatibility report after stable UI ICU migration. Stable literals routed through useStableIcuMessages() are separated from computed-key compatibility paths, runtime content translation, legacy pack internals, and test harness calls.',
    summary,
    records,
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
    path.join(outputDir, 'legacy-market-pack-usage.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8'
);

const markdown = [
    '# Legacy Market-Pack Usage Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    'This report separates reviewed ICU stable UI copy from the explicit compatibility surfaces that remain for computed keys, runtime content, legacy packs, and test harnesses.',
    '',
    '## Summary',
    '',
    `- Tracked files: ${summary.totalFiles}`,
    `- Stable ICU hook files: ${summary.stableIcuHookFiles}`,
    `- Delegated stable ICU translator files: ${summary.delegatedStableIcuFiles}`,
    `- Migrated stable ICU message IDs observed across files: ${summary.migratedStableIcuMessageIds}`,
    `- Residual legacy literal message IDs observed across files: ${summary.residualLegacyMessageIds}`,
    `- Production files with direct residual stable literals: ${summary.productionLegacyStableFiles}`,
    `- Computed-key translator lookup files: ${summary.computedTranslatorLookupFiles}`,
    `- High-risk files: ${summary.byRisk.high}`,
    `- Medium-risk files: ${summary.byRisk.medium}`,
    `- Low-risk files: ${summary.byRisk.low}`,
    `- Dynamic runtime translation files: ${summary.dynamicRuntimeFiles}`,
    `- Legacy pack import files: ${summary.legacyPackImportFiles}`,
    '',
    '## Files',
    '',
    '| Risk | File | ICU IDs | Residual legacy IDs | Signals |',
    '| --- | --- | ---: | ---: | --- |',
    ...records.map((record) => {
        const signals = [
            record.usesMarketContext ? 'useMarket' : '',
            record.usesStableIcuHook ? 'stable-icu-hook' : '',
            record.usesDelegatedStableIcuTranslator ? 'delegated-stable-icu' : '',
            record.usesComputedTranslatorLookup ? 'computed-key-compatibility' : '',
            record.usesDynamicRuntimeTranslation ? 'runtime-translation' : '',
            record.importsLegacyPacks ? 'legacy-pack-import' : '',
        ].filter(Boolean).join(', ') || 't()';
        return `| ${record.risk} | \`${record.file}\` | ${record.migratedStableIcuIdCount} | ${record.residualLegacyIdCount} | ${signals} |`;
    }),
    '',
].join('\n');

fs.writeFileSync(path.join(outputDir, 'legacy-market-pack-usage.md'), markdown, 'utf8');

console.log(`Legacy market-pack usage report: ${records.length} files`);
console.log(`High risk: ${summary.byRisk.high}; medium: ${summary.byRisk.medium}; low: ${summary.byRisk.low}`);
console.log(`Migrated stable ICU IDs: ${summary.migratedStableIcuMessageIds}; residual legacy literal IDs: ${summary.residualLegacyMessageIds}`);
console.log(`Production files with direct residual stable literals: ${summary.productionLegacyStableFiles}`);
console.log('Report: artifacts/i18n/legacy-market-pack-usage.md');

if (summary.productionLegacyStableFiles > 0) {
    process.exitCode = 1;
}
