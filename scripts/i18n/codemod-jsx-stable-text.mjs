import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const appDir = path.join(repoDir, 'app');
const appRequire = createRequire(path.join(appDir, 'package.json'));
const { parse } = appRequire('@babel/parser');
const traverseModule = appRequire('@babel/traverse');
const traverse = traverseModule.default || traverseModule;
const MagicString = appRequire('magic-string');

const artifactPath = path.join(repoDir, 'artifacts/i18n/discovered-stable-ui-text.json');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

const normalizeText = (value = '') => String(value).replace(/\s+/g, ' ').trim();
const hashText = (value = '') => crypto.createHash('sha1').update(value).digest('hex').slice(0, 8);
const toMessageId = (candidate) => {
    const base = String(candidate.suggestedIcuId || '')
        .replace(/[^A-Za-z0-9.]+/g, '.')
        .replace(/\.+/g, '.')
        .replace(/^\.|\.$/g, '');
    return `${base || 'stable.ui.text'}.${hashText(`${candidate.file}\n${candidate.context}\n${candidate.detectedText || candidate.defaultMessage}`)}`;
};

const jsxStableText = (id, defaultMessage) => (
    `<StableText id={${JSON.stringify(id)}} defaultMessage={${JSON.stringify(defaultMessage)}} />`
);

const parseSource = (file, source) => parse(source, {
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
    sourceFilename: file,
    sourceType: 'unambiguous',
});

const getCalleeName = (callee) => {
    if (!callee) return '';
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression') {
        const objectName = getCalleeName(callee.object);
        const propertyName = callee.property?.type === 'Identifier'
            ? callee.property.name
            : callee.property?.type === 'StringLiteral'
                ? callee.property.value
                : '';
        return objectName && propertyName ? `${objectName}.${propertyName}` : propertyName;
    }
    return '';
};

const isTranslateCall = (node) => {
    const name = getCalleeName(node?.callee);
    return /^translate[A-Z].*Text$/.test(name) || /^translate.*Text$/.test(name);
};

const readString = (node) => {
    if (node?.type === 'StringLiteral') return node.value;
    return '';
};

const findCandidate = (candidatesByRange, node, contexts) => {
    const candidate = candidatesByRange.get(`${node.start}:${node.end}`);
    if (!candidate || !contexts.has(candidate.context)) return null;
    return candidate;
};

const insertStableTextImport = (source, magic) => {
    if (source.includes('@/i18n/StableText')) return;

    const importMatches = [...source.matchAll(/^import[\s\S]*?;\s*$/gm)];
    const insertAt = importMatches.length > 0
        ? importMatches[importMatches.length - 1].index + importMatches[importMatches.length - 1][0].length
        : 0;
    magic.appendLeft(insertAt, "\nimport { StableText } from '@/i18n/StableText';");
};

const candidates = artifact.candidates
    .filter((candidate) => (
        !candidate.excluded
        && !candidate.alreadyCoveredByIcu
        && candidate.file.startsWith('app/src/')
        && Number.isInteger(candidate.sourceStart)
        && Number.isInteger(candidate.sourceEnd)
        && ['jsx-text', 'jsx-expression'].includes(candidate.context)
    ));

const byFile = new Map();
candidates.forEach((candidate) => {
    const entries = byFile.get(candidate.file) || [];
    entries.push(candidate);
    byFile.set(candidate.file, entries);
});

const report = [];

for (const [file, fileCandidates] of byFile.entries()) {
    const absolutePath = path.join(repoDir, file);
    const source = fs.readFileSync(absolutePath, 'utf8');
    const ast = parseSource(file, source);
    const magic = new MagicString(source);
    const candidatesByRange = new Map(fileCandidates.map((candidate) => [
        `${candidate.sourceStart}:${candidate.sourceEnd}`,
        {
            ...candidate,
            stableId: toMessageId(candidate),
        },
    ]));
    const replacedRanges = new Set();
    let replacements = 0;

    const replaceRange = (start, end, replacement) => {
        const key = `${start}:${end}`;
        if (replacedRanges.has(key)) return false;
        replacedRanges.add(key);
        magic.overwrite(start, end, replacement);
        replacements += 1;
        return true;
    };

    traverse(ast, {
        JSXText(pathRef) {
            const { node } = pathRef;
            const candidate = findCandidate(candidatesByRange, node, new Set(['jsx-text']));
            if (!candidate) return;

            const raw = source.slice(node.start, node.end);
            const leading = raw.match(/^\s*/)?.[0] || '';
            const trailing = raw.match(/\s*$/)?.[0] || '';
            replaceRange(
                node.start,
                node.end,
                `${leading}${jsxStableText(candidate.stableId, candidate.detectedText || candidate.defaultMessage)}${trailing}`
            );
        },
        StringLiteral(pathRef) {
            const { node } = pathRef;
            const candidate = findCandidate(candidatesByRange, node, new Set(['jsx-expression']));
            if (!candidate) return;

            const jsxExpression = pathRef.findParent((parent) => parent.isJSXExpressionContainer());
            if (!jsxExpression) return;

            const logicalExpression = pathRef.findParent((parent) => parent.isLogicalExpression());
            if (
                logicalExpression?.node?.operator === '||'
                && jsxExpression.get('expression') === logicalExpression
            ) {
                const left = logicalExpression.node.left;
                const right = logicalExpression.node.right;
                const fallbackText = readString(right);
                if (
                    fallbackText === candidate.detectedText
                    && left?.type === 'CallExpression'
                    && isTranslateCall(left)
                    && readString(left.arguments?.[0]) === fallbackText
                ) {
                    replaceRange(
                        logicalExpression.node.start,
                        logicalExpression.node.end,
                        jsxStableText(candidate.stableId, fallbackText)
                    );
                }
                return;
            }

            const callExpression = pathRef.findParent((parent) => parent.isCallExpression());
            if (callExpression && callExpression.node.start > jsxExpression.node.start) return;

            replaceRange(
                node.start,
                node.end,
                jsxStableText(candidate.stableId, candidate.detectedText || candidate.defaultMessage)
            );
        },
    });

    if (replacements === 0) continue;

    insertStableTextImport(source, magic);
    fs.writeFileSync(absolutePath, magic.toString(), 'utf8');
    report.push({ file, replacements });
}

console.log(`StableText JSX codemod updated ${report.length} files.`);
report.forEach(({ file, replacements }) => {
    console.log(`${replacements}\t${file}`);
});
