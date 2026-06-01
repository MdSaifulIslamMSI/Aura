import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
    appDir,
    collectLegacyMigrationInventory,
    outputDir,
    repoDir,
} from './legacy-migration-lib.mjs';

const appRequire = createRequire(path.join(appDir, 'package.json'));
const { parse } = appRequire('@babel/parser');
const traverseModule = appRequire('@babel/traverse');
const traverse = traverseModule.default || traverseModule;
const APPLY_FLAG = '--apply';
const apply = process.argv.includes(APPLY_FLAG);
const hookImport = "import { useStableIcuMessages } from '@/i18n/useStableIcuMessages';";
const report = await collectLegacyMigrationInventory();
const alreadyMigratedFiles = [];
const changedFiles = [];
const delegatedFiles = [];
const skippedFiles = [];

const parseSource = (file, source) => parse(source, {
    plugins: ['jsx', 'typescript', 'classProperties', 'dynamicImport', 'importMeta', 'topLevelAwait'],
    sourceFilename: file,
    sourceType: 'unambiguous',
});

const applyEdits = (source, edits) => edits
    .sort((left, right) => right.start - left.start)
    .reduce((result, edit) => `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`, source);

const productionFiles = report.fileRecords
    .filter(({ isTestFile, stableLiteralCount }) => !isTestFile && stableLiteralCount > 0)
    .map(({ file }) => file);

productionFiles.forEach((file) => {
    const absolutePath = path.join(repoDir, file);
    const source = fs.readFileSync(absolutePath, 'utf8');
    const ast = parseSource(file, source);
    const edits = [];
    const declarationInsertions = new Map();
    let hasHookImport = false;
    let hasHookBinding = false;
    let replacementCount = 0;

    traverse(ast, {
        ImportDeclaration(importPath) {
            if (importPath.node.source.value === '@/i18n/useStableIcuMessages') {
                hasHookImport = true;
            }
        },
        VariableDeclarator(variablePath) {
            const { node } = variablePath;
            if (
                node.id?.type === 'Identifier'
                && node.id.name === 't'
                && node.init?.type === 'CallExpression'
                && node.init.callee?.type === 'Identifier'
                && node.init.callee.name === 'useStableIcuMessages'
            ) {
                hasHookBinding = true;
            }
            if (
                node.init?.type !== 'CallExpression'
                || node.init.callee?.type !== 'Identifier'
                || node.init.callee.name !== 'useMarket'
                || node.id?.type !== 'ObjectPattern'
            ) {
                return;
            }

            const tProperty = node.id.properties.find((property) => (
                property.type === 'ObjectProperty'
                && !property.computed
                && property.key?.type === 'Identifier'
                && property.key.name === 't'
                && property.value?.type === 'Identifier'
                && property.value.name === 't'
            ));
            if (!tProperty) return;

            edits.push({
                end: tProperty.end,
                start: tProperty.start,
                text: 't: legacyT',
            });
            replacementCount += 1;

            const declaration = variablePath.findParent((candidate) => candidate.isVariableDeclaration())?.node;
            if (!declaration) {
                throw new Error(`Unable to locate useMarket() variable declaration in ${file}.`);
            }
            const indentation = source.slice(0, declaration.start).match(/(^|\n)([ \t]*)[^\n]*$/)?.[2] || '';
            declarationInsertions.set(declaration.end, `\n${indentation}const t = useStableIcuMessages(legacyT);`);
        },
    });

    declarationInsertions.forEach((text, start) => {
        edits.push({ end: start, start, text });
    });

    if (replacementCount === 0) {
        if (hasHookImport && hasHookBinding) {
            alreadyMigratedFiles.push({ file });
            return;
        }
        delegatedFiles.push({
            file,
            reason: 'No direct useMarket() t destructuring found. Translator is supplied by the migrated caller and remains tracked for review.',
        });
        return;
    }

    if (!hasHookImport) {
        const importNodes = ast.program.body.filter(({ type }) => type === 'ImportDeclaration');
        const lastImport = importNodes[importNodes.length - 1];
        edits.push({
            end: lastImport?.end || 0,
            start: lastImport?.end || 0,
            text: `${lastImport ? '\n' : ''}${hookImport}`,
        });
    }

    const nextSource = applyEdits(source, edits);
    if (apply) fs.writeFileSync(absolutePath, nextSource, 'utf8');

    changedFiles.push({
        dynamicLookupReferences: report.dynamicLookupReferences.filter((reference) => reference.file === file).length,
        file,
        hookBindingsMigrated: replacementCount,
    });
});

const result = {
    applied: apply,
    alreadyMigratedFiles,
    changedFiles,
    delegatedFiles,
    generatedAt: new Date().toISOString(),
    note: 'Safe stable-UI ICU codemod. Literal calls are routed through useStableIcuMessages(); computed keys remain delegated to the legacy translator and are reported for manual review.',
    skippedFiles,
    summary: {
        changedFiles: changedFiles.length,
        dynamicLookupReferencesHeldForManualReview: report.summary.dynamicLookupReferences,
        delegatedFiles: delegatedFiles.length,
        alreadyMigratedFiles: alreadyMigratedFiles.length,
        hookBindingsMigrated: changedFiles.reduce((total, file) => total + file.hookBindingsMigrated, 0),
        skippedFiles: skippedFiles.length,
        stableProductionIds: report.summary.uniqueProductionStableIds,
    },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
    path.join(outputDir, 'stable-ui-icu-codemod-report.json'),
    `${JSON.stringify(result, null, 2)}\n`,
    'utf8'
);
fs.writeFileSync(path.join(outputDir, 'stable-ui-icu-codemod-report.md'), [
    '# Stable UI ICU Codemod Report',
    '',
    `Generated: ${result.generatedAt}`,
    '',
    `Mode: ${apply ? 'apply' : 'dry-run'}`,
    '',
    result.note,
    '',
    '## Summary',
    '',
    `- Stable production IDs: ${result.summary.stableProductionIds}`,
    `- Files changed: ${result.summary.changedFiles}`,
    `- Already-migrated files: ${result.summary.alreadyMigratedFiles}`,
    `- Hook bindings migrated: ${result.summary.hookBindingsMigrated}`,
    `- Dynamic lookups held for manual review: ${result.summary.dynamicLookupReferencesHeldForManualReview}`,
    `- Delegated translator files: ${result.summary.delegatedFiles}`,
    `- Skipped files: ${result.summary.skippedFiles}`,
    '',
    '## Files',
    '',
    '| File | Hook bindings | Dynamic lookups retained |',
    '| --- | ---: | ---: |',
    ...changedFiles.map((file) => `| \`${file.file}\` | ${file.hookBindingsMigrated} | ${file.dynamicLookupReferences} |`),
    '',
    '## Already Migrated',
    '',
    ...alreadyMigratedFiles.map((file) => `- \`${file.file}\``),
    '',
    '## Delegated Translators',
    '',
    ...delegatedFiles.map((file) => `- \`${file.file}\`: ${file.reason}`),
    '',
    '## Unexplained Skips',
    '',
    ...skippedFiles.map((file) => `- \`${file.file}\`: ${file.reason}`),
].join('\n'), 'utf8');

console.log(`Stable UI ICU codemod ${apply ? 'applied' : 'dry-run complete'}.`);
console.log(`Files: ${result.summary.changedFiles}; already migrated: ${result.summary.alreadyMigratedFiles}; hook bindings: ${result.summary.hookBindingsMigrated}; delegated: ${result.summary.delegatedFiles}; skips: ${result.summary.skippedFiles}`);
console.log(`Dynamic lookups held for review: ${result.summary.dynamicLookupReferencesHeldForManualReview}`);
console.log('Report: artifacts/i18n/stable-ui-icu-codemod-report.md');

if (skippedFiles.length > 0) {
    process.exitCode = 1;
}
