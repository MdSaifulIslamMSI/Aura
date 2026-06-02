import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoDir = path.resolve(scriptDir, '../..');
export const appDir = path.join(repoDir, 'app');
export const sourceDir = path.join(appDir, 'src');
export const outputDir = path.join(repoDir, 'artifacts/i18n');

const appRequire = createRequire(path.join(appDir, 'package.json'));
const { parse } = appRequire('@babel/parser');
const traverseModule = appRequire('@babel/traverse');
const traverse = traverseModule.default || traverseModule;

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', 'test-results']);
const TEST_FILE_PATTERN = /\.(test|spec)\.[jt]sx?$/i;
const STABLE_ICU_CALL_NAMES = new Set(['t', 'formatStablePlaceholder']);
const RUNTIME_ENUM_COMPATIBILITY_FILES = new Set([
    'app/src/utils/enumLocalization.js',
]);
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

const normalizePath = (filePath) => path.relative(repoDir, filePath).replace(/\\/g, '/');

const walkFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
        return SKIP_DIRS.has(entry.name) ? [] : walkFiles(entryPath);
    }
    return CODE_EXTENSIONS.has(path.extname(entry.name)) ? [entryPath] : [];
});

const parseSource = (filePath, source) => parse(source, {
    errorRecovery: false,
    plugins: [
        'jsx',
        'typescript',
        'classProperties',
        'dynamicImport',
        'importMeta',
        'topLevelAwait',
    ],
    sourceFilename: normalizePath(filePath),
    sourceType: 'unambiguous',
});

const readStaticString = (node) => {
    if (!node) return '';
    if (node.type === 'StringLiteral') return node.value;
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
        return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('');
    }
    return '';
};

const readStaticJsxAttribute = (attributes = [], name) => {
    const attribute = attributes.find((entry) => (
        entry.type === 'JSXAttribute'
        && entry.name?.type === 'JSXIdentifier'
        && entry.name.name === name
    ));
    if (!attribute?.value) return '';
    if (attribute.value.type === 'StringLiteral') return attribute.value.value;
    if (attribute.value.type === 'JSXExpressionContainer') return readStaticString(attribute.value.expression);
    return '';
};

const readSourceSlice = (source, node) => (
    Number.isInteger(node?.start) && Number.isInteger(node?.end)
        ? source.slice(node.start, node.end)
        : ''
);

const getObjectValueTokens = (source, node) => {
    if (node?.type !== 'ObjectExpression') return new Map();

    return new Map(node.properties.flatMap((property) => {
        if (property.type !== 'ObjectProperty' || property.computed) return [];
        const key = property.key.type === 'Identifier'
            ? property.key.name
            : property.key.type === 'StringLiteral'
                ? property.key.value
                : '';
        const expression = readSourceSlice(source, property.value);
        return key && expression ? [[expression, key]] : [];
    }));
};

const getExpressionFallbackToken = (source, node, valueTokens, index) => {
    const exactToken = valueTokens.get(readSourceSlice(source, node));
    if (exactToken) return exactToken;
    if (node?.type === 'Identifier') return node.name;
    if (node?.type === 'MemberExpression' && !node.computed && node.property?.type === 'Identifier') {
        return node.property.name;
    }
    return `value${index + 1}`;
};

const readFallbackTemplate = (source, node, valuesNode) => {
    const staticValue = readStaticString(node);
    if (staticValue) return staticValue;
    if (node?.type !== 'TemplateLiteral') return '';

    const valueTokens = getObjectValueTokens(source, valuesNode);
    return node.quasis.map((quasi, index) => {
        const literal = quasi.value.cooked ?? quasi.value.raw;
        const expression = node.expressions[index];
        if (!expression) return literal;
        return `${literal}{{${getExpressionFallbackToken(source, expression, valueTokens, index)}}}`;
    }).join('');
};

export const convertLegacyTemplateToIcu = (template = '') => String(template || '')
    .replace(/\{\{\s*([^}\s]+)\s*\}\}/g, '{$1}');

export const getInterpolationTokens = (template = '') => [
    ...new Set(
        [...String(template || '').matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)]
            .map((match) => match[1])
    ),
].sort();

export const classifyRisk = (ids = [], hasDynamicRuntimeUsage = false) => {
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

const summarizeReference = ({
    file,
    node,
    id = '',
    fallback = '',
    legacyEnglishTemplate = '',
    kind,
    reason = '',
}) => {
    const defaultMessage = legacyEnglishTemplate || fallback || id;
    return {
        column: node.loc?.start.column + 1 || 1,
        defaultMessageSource: legacyEnglishTemplate
            ? 'legacy-english-pack'
            : fallback
                ? 'call-site-fallback'
                : 'message-id',
        fallback,
        file,
        icuDefaultMessage: convertLegacyTemplateToIcu(defaultMessage),
        id,
        interpolationTokens: getInterpolationTokens(defaultMessage),
        kind,
        legacyEnglishTemplate,
        line: node.loc?.start.line || 1,
        reason,
    };
};

export const collectLegacyMigrationInventory = async () => {
    const marketConfig = await import(pathToFileURL(path.join(sourceDir, 'config/marketConfig.js')).href);
    const files = walkFiles(sourceDir);
    const parseErrors = [];
    const stableReferences = [];
    const dynamicLookupReferences = [];
    const runtimeEnumCompatibilityReferences = [];
    const runtimeContentFiles = [];
    const runtimeEnumCompatibilityFiles = [];
    const legacyPackInternalFiles = [];
    const fileRecords = [];

    files.forEach((filePath) => {
        const source = fs.readFileSync(filePath, 'utf8');
        const file = normalizePath(filePath);
        const usesDynamicRuntimeTranslation = /\buseDynamicTranslations\s*\(/.test(source)
            || /\brequestRuntimeTranslations\s*\(/.test(source)
            || /\bMarketAutoLocalizer\b/.test(source);
        const importsLegacyPacks = /marketMessagePacks|marketMessages\.generated|MARKET_MESSAGE_PACK/.test(source);
        const isTestFile = TEST_FILE_PATTERN.test(file);
        const isRuntimeEnumCompatibilityFile = RUNTIME_ENUM_COMPATIBILITY_FILES.has(file);
        const fileStableReferences = [];
        const fileDynamicReferences = [];
        const fileRuntimeEnumCompatibilityReferences = [];

        if (usesDynamicRuntimeTranslation) runtimeContentFiles.push(file);
        if (isRuntimeEnumCompatibilityFile) runtimeEnumCompatibilityFiles.push(file);
        if (importsLegacyPacks) legacyPackInternalFiles.push(file);

        let ast;
        try {
            ast = parseSource(filePath, source);
        } catch (error) {
            parseErrors.push({ file, message: error.message });
            return;
        }

        traverse(ast, {
            CallExpression(callPath) {
                const { node } = callPath;
                if (node.callee.type !== 'Identifier' || !STABLE_ICU_CALL_NAMES.has(node.callee.name)) return;

                const id = readStaticString(node.arguments[0]);
                const fallback = readFallbackTemplate(source, node.arguments[2], node.arguments[1]);
                if (!id || id.includes('${')) {
                    const reference = summarizeReference({
                        fallback,
                        file,
                        kind: isRuntimeEnumCompatibilityFile ? 'runtime-enum-compatibility' : 'dynamic-lookup',
                        node,
                        reason: isRuntimeEnumCompatibilityFile
                            ? 'Generic runtime enum translation utility; callers supply reviewed prefixes and runtime values.'
                            : 'First t() argument is computed or interpolated and requires manual review.',
                    });
                    if (isRuntimeEnumCompatibilityFile) {
                        fileRuntimeEnumCompatibilityReferences.push(reference);
                        runtimeEnumCompatibilityReferences.push(reference);
                    } else {
                        fileDynamicReferences.push(reference);
                        dynamicLookupReferences.push(reference);
                    }
                    return;
                }

                const legacyEnglishTemplate = marketConfig.getMessageTemplate('en', id);
                const reference = summarizeReference({
                    fallback,
                    file,
                    id,
                    kind: isTestFile ? 'test-harness-literal' : 'stable-ui-literal',
                    legacyEnglishTemplate,
                    node,
                    reason: isTestFile
                        ? 'Test harness literal is tracked but excluded from production call-site migration.'
                        : '',
                });
                fileStableReferences.push(reference);
                stableReferences.push(reference);
            },
            JSXOpeningElement(openingPath) {
                const { node } = openingPath;
                if (node.name?.type !== 'JSXIdentifier' || node.name.name !== 'StableText') return;

                const id = readStaticJsxAttribute(node.attributes, 'id');
                const fallback = readStaticJsxAttribute(node.attributes, 'defaultMessage');
                if (!id || id.includes('${')) {
                    const reference = summarizeReference({
                        fallback,
                        file,
                        kind: 'dynamic-lookup',
                        node,
                        reason: 'StableText id is computed and requires manual review.',
                    });
                    fileDynamicReferences.push(reference);
                    dynamicLookupReferences.push(reference);
                    return;
                }

                const legacyEnglishTemplate = marketConfig.getMessageTemplate('en', id);
                const reference = summarizeReference({
                    fallback,
                    file,
                    id,
                    kind: isTestFile ? 'test-harness-literal' : 'stable-ui-literal',
                    legacyEnglishTemplate,
                    node,
                    reason: isTestFile
                        ? 'Test harness literal is tracked but excluded from production call-site migration.'
                        : '',
                });
                fileStableReferences.push(reference);
                stableReferences.push(reference);
            },
        });

        if (
            fileStableReferences.length > 0
            || fileDynamicReferences.length > 0
            || fileRuntimeEnumCompatibilityReferences.length > 0
            || usesDynamicRuntimeTranslation
            || importsLegacyPacks
        ) {
            const ids = [...new Set(fileStableReferences.map(({ id }) => id))].sort();
            fileRecords.push({
                dynamicLookupCount: fileDynamicReferences.length,
                file,
                importsLegacyPacks,
                isTestFile,
                runtimeEnumCompatibilityCount: fileRuntimeEnumCompatibilityReferences.length,
                messageIdCount: ids.length,
                messageIds: ids,
                risk: classifyRisk(ids, usesDynamicRuntimeTranslation),
                stableLiteralCount: fileStableReferences.length,
                isRuntimeEnumCompatibilityFile,
                usesDynamicRuntimeTranslation,
            });
        }
    });

    const productionStableReferences = stableReferences.filter(({ kind }) => kind === 'stable-ui-literal');
    const testHarnessReferences = stableReferences.filter(({ kind }) => kind === 'test-harness-literal');
    const uniqueProductionStableIds = [...new Set(productionStableReferences.map(({ id }) => id))].sort();
    const unresolvedEnglishDefaults = productionStableReferences.filter(({ defaultMessageSource }) => (
        defaultMessageSource === 'message-id'
    ));
    const summary = {
        dynamicLookupReferences: dynamicLookupReferences.length,
        legacyPackInternalFiles: [...new Set(legacyPackInternalFiles)].length,
        parseErrors: parseErrors.length,
        productionFiles: [...new Set(productionStableReferences.map(({ file }) => file))].length,
        productionStableReferences: productionStableReferences.length,
        runtimeContentFiles: [...new Set(runtimeContentFiles)].length,
        runtimeEnumCompatibilityFiles: [...new Set(runtimeEnumCompatibilityFiles)].length,
        runtimeEnumCompatibilityReferences: runtimeEnumCompatibilityReferences.length,
        sourceFilesScanned: files.length,
        testHarnessReferences: testHarnessReferences.length,
        totalTrackedFiles: fileRecords.length,
        uniqueProductionStableIds: uniqueProductionStableIds.length,
        unresolvedEnglishDefaults: unresolvedEnglishDefaults.length,
    };

    return {
        dynamicLookupReferences,
        fileRecords: fileRecords.sort((left, right) => (
            ({ high: 0, medium: 1, low: 2 })[left.risk] - ({ high: 0, medium: 1, low: 2 })[right.risk]
            || right.messageIdCount - left.messageIdCount
            || left.file.localeCompare(right.file)
        )),
        generatedAt: new Date().toISOString(),
        legacyPackInternalFiles: [...new Set(legacyPackInternalFiles)].sort(),
        note: 'Complete pre-migration inventory for legacy market-pack t() usage. Stable UI literals are ICU migration candidates. Dynamic lookups, runtime content, pack internals, and test harness calls remain explicit review buckets.',
        parseErrors,
        productionStableReferences,
        runtimeEnumCompatibilityFiles: [...new Set(runtimeEnumCompatibilityFiles)].sort(),
        runtimeEnumCompatibilityReferences,
        runtimeContentFiles: [...new Set(runtimeContentFiles)].sort(),
        summary,
        testHarnessReferences,
        uniqueProductionStableIds,
        unresolvedEnglishDefaults,
    };
};
