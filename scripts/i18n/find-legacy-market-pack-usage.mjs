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

    if (
        messageIds.length === 0
        && !usesDynamicRuntimeTranslation
        && !importsLegacyPacks
    ) {
        return null;
    }

    const relativePath = path.relative(repoDir, filePath).replace(/\\/g, '/');
    const uniqueIds = [...new Set(messageIds)].sort();
    return {
        file: relativePath,
        importsLegacyPacks,
        messageIdCount: uniqueIds.length,
        messageIds: uniqueIds,
        risk: classifyRisk(uniqueIds, usesDynamicRuntimeTranslation),
        usesDynamicRuntimeTranslation,
        usesMarketContext,
    };
};

const records = walkFiles(sourceDir)
    .map(collectLegacyUsage)
    .filter(Boolean)
    .sort((left, right) => {
        const riskOrder = { high: 0, medium: 1, low: 2 };
        return riskOrder[left.risk] - riskOrder[right.risk]
            || right.messageIdCount - left.messageIdCount
            || left.file.localeCompare(right.file);
    });

const summary = records.reduce((acc, record) => {
    acc.totalFiles += 1;
    acc.totalMessageIds += record.messageIdCount;
    acc.byRisk[record.risk] += 1;
    if (record.usesDynamicRuntimeTranslation) acc.dynamicRuntimeFiles += 1;
    if (record.importsLegacyPacks) acc.legacyPackImportFiles += 1;
    return acc;
}, {
    byRisk: { high: 0, medium: 0, low: 0 },
    dynamicRuntimeFiles: 0,
    legacyPackImportFiles: 0,
    totalFiles: 0,
    totalMessageIds: 0,
});

const report = {
    generatedAt: new Date().toISOString(),
    note: 'Non-blocking inventory for incremental migration from legacy market-pack t() calls to reviewed FormatJS ICU messages.',
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
    'This report is informational. It tracks remaining stable UI copy still flowing through legacy market-pack lookups or dynamic runtime translation hooks.',
    '',
    '## Summary',
    '',
    `- Files with legacy usage: ${summary.totalFiles}`,
    `- Unique message IDs observed across files: ${summary.totalMessageIds}`,
    `- High-risk files: ${summary.byRisk.high}`,
    `- Medium-risk files: ${summary.byRisk.medium}`,
    `- Low-risk files: ${summary.byRisk.low}`,
    `- Dynamic runtime translation files: ${summary.dynamicRuntimeFiles}`,
    `- Legacy pack import files: ${summary.legacyPackImportFiles}`,
    '',
    '## Files',
    '',
    '| Risk | File | IDs | Signals |',
    '| --- | --- | ---: | --- |',
    ...records.map((record) => {
        const signals = [
            record.usesMarketContext ? 'useMarket' : '',
            record.usesDynamicRuntimeTranslation ? 'runtime-translation' : '',
            record.importsLegacyPacks ? 'legacy-pack-import' : '',
        ].filter(Boolean).join(', ') || 't()';
        return `| ${record.risk} | \`${record.file}\` | ${record.messageIdCount} | ${signals} |`;
    }),
    '',
].join('\n');

fs.writeFileSync(path.join(outputDir, 'legacy-market-pack-usage.md'), markdown, 'utf8');

console.log(`Legacy market-pack usage report: ${records.length} files`);
console.log(`High risk: ${summary.byRisk.high}; medium: ${summary.byRisk.medium}; low: ${summary.byRisk.low}`);
console.log('Report: artifacts/i18n/legacy-market-pack-usage.md');
