import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '../..');
const appDir = path.join(repoDir, 'app');
const outputDir = path.join(repoDir, 'artifacts/i18n');

const appRequire = createRequire(path.join(appDir, 'package.json'));
const { parse } = appRequire('@babel/parser');
const traverseModule = appRequire('@babel/traverse');
const traverse = traverseModule.default || traverseModule;

const args = new Set(process.argv.slice(2));
const checkMode = args.has('--check');

const readJson = (relativePath, fallback = null) => {
    const absolutePath = path.join(repoDir, relativePath);
    if (!fs.existsSync(absolutePath)) return fallback;
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
};

const config = readJson('scripts/i18n/discover-stable-ui-text-config.json', {});
const allowlist = readJson('scripts/i18n/discover-stable-ui-text-allowlist.json', { entries: [] });
const englishCatalog = readJson('app/src/i18n/messages/reviewed/en.json', {});

const normalizePath = (filePath) => path.relative(repoDir, filePath).replace(/\\/g, '/');
const normalizeText = (value = '') => String(value)
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ')
    .trim();
const escapeMarkdownTableCell = (value = '') => String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();

const pathIncludes = (file, needles = []) => needles.some((needle) => file.includes(needle));
const lowerPathIncludes = (file, needles = []) => {
    const normalizedFile = file.toLowerCase();
    return needles.some((needle) => normalizedFile.includes(String(needle).toLowerCase()));
};

const userVisibleProps = new Set(config.userVisibleProps || []);
const objectUiKeys = new Set(config.objectUiKeys || []);
const toastFunctionNames = new Set(config.toastFunctionNames || []);
const toastObjectNames = new Set(config.toastObjectNames || []);
const toastMethodNames = new Set(config.toastMethodNames || []);
const validationFunctionNames = new Set(config.validationFunctionNames || []);
const validationPropertyNames = new Set(config.validationPropertyNames || []);
const codeExtensions = new Set(['.js', '.jsx', '.ts', '.tsx']);

const catalogTextToIds = Object.entries(englishCatalog).reduce((acc, [id, message]) => {
    const normalized = normalizeText(message);
    if (!normalized) return acc;
    const ids = acc.get(normalized) || [];
    ids.push(id);
    acc.set(normalized, ids);
    return acc;
}, new Map());

const existingIds = new Set(Object.keys(englishCatalog));

const allowlistMatches = (file, text, context) => (allowlist.entries || []).find((entry) => {
    if (entry.file && entry.file !== file) return false;
    if (entry.text && normalizeText(entry.text) !== text) return false;
    if (entry.context && entry.context !== context) return false;
    return true;
});

const isTestFile = (file) => /\.(test|spec)\.[jt]sx?$/i.test(file)
    || file.includes('/__tests__/')
    || file.includes('/test/')
    || file.includes('/tests/');

const isGeneratedOrSkippedPath = (file) => pathIncludes(file, config.skipPathIncludes || []);

const shouldScanJsonFile = (file) => {
    if (/(^|\/)package-lock\.json$/i.test(file)) return false;
    if (/(^|\/)(package|tsconfig|jsconfig|vite\.config|playwright\.config|eslint\.config)\.json$/i.test(file)) {
        return false;
    }
    return lowerPathIncludes(file, config.jsonUiPathIncludes || []);
};

const walkFiles = (entryPath) => {
    if (!fs.existsSync(entryPath)) return [];
    const stats = fs.statSync(entryPath);
    if (stats.isFile()) {
        const file = normalizePath(entryPath);
        const extension = path.extname(entryPath);
        if (isGeneratedOrSkippedPath(file)) return [];
        if (codeExtensions.has(extension)) return [entryPath];
        if (extension === '.html') return [entryPath];
        if (extension === '.json' && shouldScanJsonFile(file)) return [entryPath];
        return [];
    }

    return fs.readdirSync(entryPath, { withFileTypes: true }).flatMap((entry) => {
        if (entry.isDirectory() && (config.skipDirectories || []).includes(entry.name)) return [];
        return walkFiles(path.join(entryPath, entry.name));
    });
};

const collectFiles = () => [...new Set((config.scanRoots || []).flatMap((root) => (
    walkFiles(path.join(repoDir, root))
)))].sort((left, right) => normalizePath(left).localeCompare(normalizePath(right)));

const parseSource = (filePath, source) => parse(source, {
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
    sourceFilename: normalizePath(filePath),
    sourceType: 'unambiguous',
});

const getNodeLocation = (source, node) => {
    if (node?.loc?.start) {
        return {
            column: node.loc.start.column + 1,
            line: node.loc.start.line,
        };
    }

    if (!Number.isInteger(node?.start)) {
        return { column: 1, line: 1 };
    }

    const before = source.slice(0, node.start);
    const lines = before.split(/\r?\n/);
    return {
        column: lines[lines.length - 1].length + 1,
        line: lines.length,
    };
};

const readStringValue = (node) => {
    if (!node) return null;
    if (node.type === 'StringLiteral') {
        return { text: normalizeText(node.value), variables: [], defaultMessage: normalizeText(node.value) };
    }
    if (node.type === 'TemplateLiteral') {
        const variables = [];
        const parts = [];
        node.quasis.forEach((quasi, index) => {
            parts.push(quasi.value.cooked ?? quasi.value.raw);
            const expression = node.expressions[index];
            if (expression) {
                const variable = expression.type === 'Identifier'
                    ? expression.name
                    : expression.type === 'MemberExpression' && expression.property?.type === 'Identifier'
                        ? expression.property.name
                        : `value${index + 1}`;
                variables.push(variable);
                parts.push(`{${variable}}`);
            }
        });
        const defaultMessage = normalizeText(parts.join(''));
        return { text: defaultMessage, variables: [...new Set(variables)].sort(), defaultMessage };
    }
    return null;
};

const readJsxAttributeValue = (attribute) => {
    if (!attribute?.value) return null;
    if (attribute.value.type === 'StringLiteral') return readStringValue(attribute.value);
    if (attribute.value.type === 'JSXExpressionContainer') return readStringValue(attribute.value.expression);
    return null;
};

const keyName = (node) => {
    if (!node) return '';
    if (node.type === 'Identifier' || node.type === 'JSXIdentifier') return node.name;
    if (node.type === 'StringLiteral') return node.value;
    return '';
};

const calleeName = (callee) => {
    if (!callee) return '';
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression') {
        const objectName = callee.object?.type === 'Identifier' ? callee.object.name : calleeName(callee.object);
        const propertyName = callee.property?.type === 'Identifier'
            ? callee.property.name
            : callee.property?.type === 'StringLiteral'
                ? callee.property.value
                : '';
        return objectName && propertyName ? `${objectName}.${propertyName}` : propertyName;
    }
    return '';
};

const isConsoleOrLoggerCall = (pathRef) => {
    const call = pathRef.findParent((candidate) => candidate.isCallExpression());
    const name = calleeName(call?.node?.callee);
    return /^console\./.test(name)
        || /^logger\./.test(name)
        || /^log\./.test(name)
        || name === 'debug'
        || name === 'warn';
};

const isInsideExistingIcu = (pathRef) => {
    const call = pathRef.findParent((candidate) => candidate.isCallExpression());
    const name = calleeName(call?.node?.callee);
    if (['defineMessage', 'defineMessages', 'formatMessage', 'intl.formatMessage', 't'].includes(name)) return true;
    if (name.endsWith('.formatMessage')) return true;

    const jsxOpening = pathRef.findParent((candidate) => candidate.isJSXOpeningElement());
    const tagName = keyName(jsxOpening?.node?.name);
    if (tagName === 'FormattedMessage') return true;
    if (tagName === 'StableText') return true;

    const file = normalizePath(pathRef.hub?.file?.opts?.filename || '');
    return file.includes('app/src/i18n/');
};

const isImportExportLiteral = (pathRef) => Boolean(pathRef.findParent((candidate) => (
    candidate.isImportDeclaration()
    || candidate.isExportNamedDeclaration()
    || candidate.isExportAllDeclaration()
)));

const enclosingJsxAttributeName = (pathRef) => {
    const attribute = pathRef.findParent((candidate) => candidate.isJSXAttribute());
    return keyName(attribute?.node?.name);
};

const visibleLowercaseWords = new Set(['all', 'no', 'off', 'ok', 'on', 'yes']);

const isLikelyStructuredToken = (text) => {
    const parts = String(text || '').split(/[._:-]/);
    return parts.length >= 3 && parts.every((part) => /^[a-z0-9]+$/i.test(part));
};

const isLikelyNonHumanText = (text) => {
    if (!text || text.length < 2) return true;
    if (!/[A-Za-z\u0600-\u06FF\u0900-\u097F\u0980-\u09FF]/.test(text)) return true;
    if (/^(?:Apple|Facebook|GitHub|Google|Instagram|Microsoft|Stripe|Twitter|YouTube|Aura|X)$/i.test(text)) return true;
    if (/^n\/a$/i.test(text)) return true;
    if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/i.test(text)) return true;
    if (/^\d{5,}$/.test(text.replace(/\s+/g, ''))) return true;
    if (/^\(\{[A-Za-z_][A-Za-z0-9_]*\}\)$/.test(text)) return true;
    if (/^["']?\{[A-Za-z_][A-Za-z0-9_]*\}["']?[.!?]?$/.test(text)) return true;
    if (/^[\-|·]\s*\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(text)) return true;
    if (/^·\s*\{[A-Za-z_][A-Za-z0-9_]*\}x\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(text)) return true;
    if (/^\{[A-Za-z_][A-Za-z0-9_]*\}\+$/.test(text)) return true;
    if (/^\{[A-Za-z_][A-Za-z0-9_]*\}%\+$/.test(text)) return true;
    if (/^\{[A-Za-z_][A-Za-z0-9_]*\}(?:\s*[-:|/x]\s*\{[A-Za-z_][A-Za-z0-9_]*\})+$/.test(text)) return true;
    if (/^\{[A-Za-z_][A-Za-z0-9_]*\}(?:\/5|%| ms)?$/i.test(text)) return true;
    if (/^(?:[A-Za-z]+:)?\/[A-Za-z0-9/_{}:.-]+$/.test(text)) return true;
    if (/\b(?:bg|border|text|hover|from|to|shadow|ring|rounded)-[A-Za-z0-9/:[\].%-]+/.test(text)) return true;
    if (/^(COD|EMI|INR|UPI|USD)$/i.test(text)) return true;
    if (/^https?:\/\//i.test(text) || /^mailto:/i.test(text) || /^tel:/i.test(text)) return true;
    if (/^\/[A-Za-z0-9/_:.-]+$/.test(text)) return true;
    if (/^\d+\s?(ms|s|sec|secs|min|mins|h|hr|hrs|d|day|days)$/i.test(text)) return true;
    if (/^(ms|px|rem|em|vh|vw|fr)$/i.test(text)) return true;
    if (/^\{?[A-Za-z0-9_]+\}?(?:[-_:]\{?[A-Za-z0-9_]+\}?)+$/.test(text)) return true;
    if (/^[A-Z0-9_]+$/.test(text) && text.length > 3) return true;
    if (isLikelyStructuredToken(text)) return true;
    if (/^[a-z][a-z0-9_-]{2,}$/.test(text) && !visibleLowercaseWords.has(text)) return true;
    if (/^[#.][A-Za-z0-9_-]+$/.test(text)) return true;
    if (/^[a-f0-9]{16,}$/i.test(text)) return true;
    return false;
};

const inferArea = (file, text) => {
    const haystack = `${file} ${text}`.toLowerCase();
    const areaRules = [
        ['checkout', ['checkout', 'cart/checkout']],
        ['payment', ['payment', 'refund', 'razorpay', 'stripe']],
        ['order', ['orders', 'order', 'tracking', 'return']],
        ['auth', ['login', 'auth', 'otp', 'passkey', 'trusted-device']],
        ['account.security', ['security', 'delete account', 'account deletion']],
        ['seller', ['seller', 'payout', 'inventory', 'listing']],
        ['support', ['support', 'incident']],
        ['admin', ['admin']],
        ['cart', ['cart']],
        ['wishlist', ['wishlist']],
        ['product', ['product', 'listing']],
        ['search', ['search', 'filter', 'discovery']],
        ['profile', ['profile', 'settings', 'address']],
        ['notification', ['notification']],
        ['common.validation', ['validation', 'error']],
        ['common.accessibility', ['aria', 'accessibility', 'alt']],
    ];

    return areaRules.find(([, needles]) => needles.some((needle) => haystack.includes(needle)))?.[0] || 'common';
};

const slugify = (text) => {
    const slug = text
        .toLowerCase()
        .replace(/\{[^}]+\}/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .slice(0, 7)
        .join('.');
    return slug || 'message';
};

const shortHash = (value) => crypto.createHash('sha1').update(value).digest('hex').slice(0, 6);

const suggestId = ({ file, text, classification, context }) => {
    const area = inferArea(file, text);
    const category = classification === 'stable-accessibility-text'
        ? 'accessibility'
        : classification === 'stable-validation-toast-text'
            ? 'feedback'
            : classification === 'stable-static-seo-template-text'
                ? 'static'
                : context?.replace(/[^a-zA-Z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').toLowerCase() || 'copy';
    const base = `${area}.${category}.${slugify(text)}`.replace(/\.+/g, '.');
    return existingIds.has(base) ? `${base}.${shortHash(`${file}:${text}`)}` : base;
};

const extractVariables = (message = '', explicitVariables = []) => [
    ...new Set([
        ...explicitVariables,
        ...[...String(message).matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((match) => match[1]),
    ]),
].sort();

const classifyRisk = ({ file, text, classification }) => {
    if (
        classification === 'stable-validation-toast-text'
        || lowerPathIncludes(file, config.highRiskPathIncludes || [])
        || (config.highRiskKeywords || []).some((keyword) => text.toLowerCase().includes(keyword))
    ) {
        return 'high';
    }
    if (
        classification === 'stable-accessibility-text'
        || lowerPathIncludes(file, config.mediumRiskPathIncludes || [])
        || (config.mediumRiskKeywords || []).some((keyword) => text.toLowerCase().includes(keyword))
    ) {
        return 'medium';
    }
    return 'low';
};

const classifyCandidate = ({ file, text, context, detectionKind, propName, pathRef }) => {
    const allow = allowlistMatches(file, text, context);
    if (allow) {
        return {
            classification: allow.classification || 'false-positive',
            excluded: true,
            reason: allow.reason || 'Explicit scanner allowlist entry.',
        };
    }
    if (isTestFile(file)) {
        return {
            classification: 'test-only-string',
            excluded: true,
            reason: 'Test or spec file; not production stable UI copy.',
        };
    }
    if (lowerPathIncludes(file, config.developerOnlyPathIncludes || []) || isConsoleOrLoggerCall(pathRef)) {
        return {
            classification: 'developer-only-string',
            excluded: true,
            reason: 'Developer-only diagnostic, script, or log text.',
        };
    }
    if (lowerPathIncludes(file, config.dynamicPathIncludes || [])) {
        return {
            classification: 'dynamic-content-exclusion',
            excluded: true,
            reason: 'Dynamic catalog, fixture, seed, seller, or database content surface.',
        };
    }
    if (isLikelyNonHumanText(text)) {
        return {
            classification: 'false-positive',
            excluded: true,
            reason: 'Not natural user-visible copy.',
        };
    }
    if (isInsideExistingIcu(pathRef)) {
        return {
            classification: 'existing-icu-text',
            excluded: true,
            reason: 'String belongs to an ICU/FormatJS descriptor or stable ICU lookup fallback.',
        };
    }
    if (file.startsWith('server/services/email/')) {
        return {
            classification: 'server-email-template-follow-up',
            excluded: true,
            reason: 'Server transactional email templates are user-visible, but this Node path has no recipient-locale catalog binding yet; tracked in docs/i18n-static-template-coverage.md.',
        };
    }
    if (propName && ['aria-label', 'aria-description', 'aria-roledescription', 'alt', 'title'].includes(propName)) {
        return {
            classification: 'stable-accessibility-text',
            excluded: false,
            reason: `User-visible accessibility or assistive prop "${propName}".`,
        };
    }
    if (
        detectionKind === 'toast-call'
        || detectionKind === 'validation-message'
        || ['errorText', 'successText', 'helperText'].includes(propName)
    ) {
        return {
            classification: 'stable-validation-toast-text',
            excluded: false,
            reason: 'User-facing validation, toast, snackbar, alert, or helper text.',
        };
    }
    if (/\.(html|json)$/i.test(file)) {
        return {
            classification: 'stable-static-seo-template-text',
            excluded: false,
            reason: 'Static HTML, manifest, metadata, or template-facing text.',
        };
    }
    return {
        classification: 'stable-ui-text',
        excluded: false,
        reason: 'Stable user-visible UI text outside an ICU/FormatJS lookup.',
    };
};

const suggestedTestCoverage = ({ classification, risk }) => {
    if (classification === 'stable-validation-toast-text') return 'Focused validation/toast unit test plus i18n check.';
    if (classification === 'stable-accessibility-text') return 'Locale accessibility smoke or component accessible-name assertion.';
    if (risk === 'high') return 'Focused flow test for auth/payment/order/seller/support/admin path.';
    if (risk === 'medium') return 'Focused component or page test for the touched UI area.';
    return 'Covered by i18n extraction/check and build unless component behavior changes.';
};

const candidates = [];
const seen = new Set();
const parseErrors = [];

const addCandidate = ({
    astNodeType,
    context,
    detectionKind,
    file,
    node,
    pathRef,
    propName = '',
    elementName = '',
    source,
    value,
}) => {
    if (!value?.text) return;
    const text = normalizeText(value.text);
    if (!text) return;
    const location = getNodeLocation(source, node);
    const dedupeKey = `${file}:${location.line}:${location.column}:${detectionKind}:${context}:${text}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const classification = classifyCandidate({ file, text, context, detectionKind, propName, pathRef });
    const defaultMessage = value.defaultMessage || text;
    const coveredByIds = catalogTextToIds.get(defaultMessage) || [];
    const risk = classification.excluded
        ? 'excluded'
        : classifyRisk({ file, text, classification: classification.classification });
    const variables = extractVariables(defaultMessage, value.variables || []);

    candidates.push({
        alreadyCoveredByIcu: coveredByIds.length > 0,
        astNodeType,
        classification: classification.classification,
        column: location.column,
        context,
        coveredByIds,
        defaultMessage,
        detectedText: text,
        excluded: classification.excluded,
        file,
        humanReviewRequired: !classification.excluded && ['high', 'medium'].includes(risk),
        jsxElementName: elementName,
        line: location.line,
        propOrFunction: propName || context,
        reason: classification.reason,
        risk,
        sourceEnd: Number.isInteger(node?.end) ? node.end : null,
        sourceStart: Number.isInteger(node?.start) ? node.start : null,
        suggestedDefaultMessage: defaultMessage,
        suggestedIcuId: classification.excluded ? '' : suggestId({
            classification: classification.classification,
            context,
            file,
            text: defaultMessage,
        }),
        suggestedTestCoverage: classification.excluded ? '' : suggestedTestCoverage({
            classification: classification.classification,
            risk,
        }),
        variables,
    });
};

const inspectCodeFile = (filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const file = normalizePath(filePath);
    let ast;

    try {
        ast = parseSource(filePath, source);
    } catch (error) {
        parseErrors.push({ file, message: error.message });
        return;
    }

    traverse(ast, {
        JSXText(pathRef) {
            const value = {
                defaultMessage: normalizeText(pathRef.node.value),
                text: normalizeText(pathRef.node.value),
                variables: [],
            };
            addCandidate({
                astNodeType: 'JSXText',
                context: 'jsx-text',
                detectionKind: 'jsx-text',
                file,
                elementName: keyName(pathRef.parentPath?.node?.openingElement?.name),
                node: pathRef.node,
                pathRef,
                source,
                value,
            });
        },
        JSXAttribute(pathRef) {
            const propName = keyName(pathRef.node.name);
            if (!userVisibleProps.has(propName)) return;
            const value = readJsxAttributeValue(pathRef.node);
            addCandidate({
                astNodeType: pathRef.node.value?.type || 'JSXAttribute',
                context: `jsx-prop:${propName}`,
                detectionKind: 'jsx-prop',
                elementName: keyName(pathRef.parentPath?.node?.name),
                file,
                node: pathRef.node,
                pathRef,
                propName,
                source,
                value,
            });
        },
        StringLiteral(pathRef) {
            if (isImportExportLiteral(pathRef)) return;
            if (pathRef.parentPath?.isJSXAttribute()) return;
            if (pathRef.parentPath?.isObjectProperty()) return;
            const jsxExpression = pathRef.findParent((candidate) => candidate.isJSXExpressionContainer());
            if (!jsxExpression) return;
            const attributeName = enclosingJsxAttributeName(pathRef);
            if (attributeName && !userVisibleProps.has(attributeName)) return;
            addCandidate({
                astNodeType: 'StringLiteral',
                context: 'jsx-expression',
                detectionKind: 'jsx-expression-string',
                file,
                node: pathRef.node,
                pathRef,
                source,
                value: readStringValue(pathRef.node),
            });
        },
        TemplateLiteral(pathRef) {
            if (pathRef.parentPath?.isTaggedTemplateExpression()) return;
            if (pathRef.parentPath?.isObjectProperty()) return;
            const jsxExpression = pathRef.findParent((candidate) => candidate.isJSXExpressionContainer());
            if (!jsxExpression) return;
            const attributeName = enclosingJsxAttributeName(pathRef);
            if (attributeName && !userVisibleProps.has(attributeName)) return;
            addCandidate({
                astNodeType: 'TemplateLiteral',
                context: 'jsx-expression',
                detectionKind: 'jsx-expression-string',
                file,
                node: pathRef.node,
                pathRef,
                source,
                value: readStringValue(pathRef.node),
            });
        },
        ObjectProperty(pathRef) {
            if (isInsideExistingIcu(pathRef)) return;
            const key = keyName(pathRef.node.key);
            if (!objectUiKeys.has(key) && !validationPropertyNames.has(key)) return;
            const value = readStringValue(pathRef.node.value);
            if (!value) return;
            const isValidation = validationPropertyNames.has(key)
                && Boolean(pathRef.findParent((candidate) => candidate.isCallExpression()));
            addCandidate({
                astNodeType: pathRef.node.value.type,
                context: `object-property:${key}`,
                detectionKind: isValidation ? 'validation-message' : 'object-property',
                file,
                node: pathRef.node.value,
                pathRef,
                propName: key,
                source,
                value,
            });
        },
        CallExpression(pathRef) {
            if (isInsideExistingIcu(pathRef)) return;
            const name = calleeName(pathRef.node.callee);
            const parts = name.split('.');
            const objectName = parts.length > 1 ? parts[parts.length - 2] : '';
            const methodName = parts[parts.length - 1] || name;
            const isToast = toastFunctionNames.has(name)
                || toastFunctionNames.has(methodName)
                || (toastObjectNames.has(objectName) && toastMethodNames.has(methodName));
            const isValidation = validationFunctionNames.has(name) || validationFunctionNames.has(methodName);
            if (!isToast && !isValidation) return;

            const firstArg = pathRef.node.arguments[0];
            const directValue = readStringValue(firstArg);
            if (directValue) {
                addCandidate({
                    astNodeType: firstArg.type,
                    context: name,
                    detectionKind: isToast ? 'toast-call' : 'validation-message',
                    file,
                    node: firstArg,
                    pathRef,
                    propName: name,
                    source,
                    value: directValue,
                });
            }

            pathRef.node.arguments.forEach((argument) => {
                if (argument?.type !== 'ObjectExpression') return;
                argument.properties.forEach((property) => {
                    if (property.type !== 'ObjectProperty') return;
                    const key = keyName(property.key);
                    if (!validationPropertyNames.has(key) && key !== 'description' && key !== 'title') return;
                    const value = readStringValue(property.value);
                    addCandidate({
                        astNodeType: property.value.type,
                        context: `${name}.${key}`,
                        detectionKind: isToast ? 'toast-call' : 'validation-message',
                        file,
                        node: property.value,
                        pathRef,
                        propName: `${name}.${key}`,
                        source,
                        value,
                    });
                });
            });
        },
    });
};

const inspectHtmlFile = (filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const file = normalizePath(filePath);
    const patterns = [
        { context: 'html-title', regex: /<title[^>]*>([^<]+)<\/title>/gi },
        { context: 'html-meta-description', regex: /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/gi },
        { context: 'html-aria-label', regex: /aria-label=["']([^"']+)["']/gi },
        { context: 'html-alt', regex: /alt=["']([^"']+)["']/gi },
        { context: 'html-placeholder', regex: /placeholder=["']([^"']+)["']/gi },
    ];

    patterns.forEach(({ context, regex }) => {
        let match;
        while ((match = regex.exec(source)) !== null) {
            const node = { start: match.index + match[0].indexOf(match[1]), type: 'HTMLText' };
            addCandidate({
                astNodeType: 'HTMLText',
                context,
                detectionKind: 'static-html',
                file,
                node,
                pathRef: { findParent: () => null, hub: { file: { opts: { filename: filePath } } } },
                propName: context,
                source,
                value: { text: normalizeText(match[1]), defaultMessage: normalizeText(match[1]), variables: [] },
            });
        }
    });
};

const inspectJsonFile = (filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const file = normalizePath(filePath);
    let parsed;
    try {
        parsed = JSON.parse(source);
    } catch (error) {
        parseErrors.push({ file, message: error.message });
        return;
    }

    const visit = (value, trail = []) => {
        if (Array.isArray(value)) {
            value.forEach((item, index) => visit(item, [...trail, String(index)]));
            return;
        }
        if (value && typeof value === 'object') {
            Object.entries(value).forEach(([key, child]) => visit(child, [...trail, key]));
            return;
        }
        if (typeof value !== 'string') return;
        const key = trail[trail.length - 1] || '';
        if (!objectUiKeys.has(key) && !userVisibleProps.has(key) && !['short_name', 'display_name'].includes(key)) {
            return;
        }
        const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = new RegExp(`"${escaped}"`).exec(source);
        const node = { start: match?.index ?? 0, type: 'JSONString' };
        addCandidate({
            astNodeType: 'JSONString',
            context: `json:${trail.join('.')}`,
            detectionKind: 'static-json',
            file,
            node,
            pathRef: { findParent: () => null, hub: { file: { opts: { filename: filePath } } } },
            propName: key,
            source,
            value: { text: normalizeText(value), defaultMessage: normalizeText(value), variables: [] },
        });
    };

    visit(parsed);
};

const files = collectFiles();
files.forEach((filePath) => {
    const extension = path.extname(filePath);
    if (codeExtensions.has(extension)) inspectCodeFile(filePath);
    if (extension === '.html') inspectHtmlFile(filePath);
    if (extension === '.json') inspectJsonFile(filePath);
});

const stableCandidates = candidates
    .filter((candidate) => !candidate.excluded)
    .sort((left, right) => {
        const riskOrder = { high: 0, medium: 1, low: 2, excluded: 3 };
        return riskOrder[left.risk] - riskOrder[right.risk]
            || left.file.localeCompare(right.file)
            || left.line - right.line
            || left.column - right.column;
    });
const dynamicExclusions = candidates
    .filter((candidate) => candidate.classification === 'dynamic-content-exclusion')
    .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
const falsePositives = candidates
    .filter((candidate) => candidate.excluded && candidate.classification !== 'dynamic-content-exclusion')
    .sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);

const countBy = (records, key) => records.reduce((acc, record) => {
    acc[record[key]] = (acc[record[key]] || 0) + 1;
    return acc;
}, {});

const stableSummary = {
    byClassification: countBy(stableCandidates, 'classification'),
    byRisk: countBy(stableCandidates, 'risk'),
    dynamicExclusions: dynamicExclusions.length,
    falsePositives: falsePositives.length,
    filesScanned: files.length,
    generatedAt: new Date().toISOString(),
    parseErrors: parseErrors.length,
    stableCandidates: stableCandidates.length,
};

const stableReport = {
    candidates: stableCandidates,
    parseErrors,
    summary: stableSummary,
};

const dynamicReport = {
    exclusions: dynamicExclusions,
    summary: {
        byReason: countBy(dynamicExclusions, 'reason'),
        generatedAt: stableSummary.generatedAt,
        total: dynamicExclusions.length,
    },
};

const falsePositiveReport = {
    entries: falsePositives.slice(0, Number(config.maxFalsePositiveEntries || 1000)),
    summary: {
        byClassification: countBy(falsePositives, 'classification'),
        generatedAt: stableSummary.generatedAt,
        reported: Math.min(falsePositives.length, Number(config.maxFalsePositiveEntries || 1000)),
        truncated: falsePositives.length > Number(config.maxFalsePositiveEntries || 1000),
        total: falsePositives.length,
    },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
    path.join(outputDir, 'discovered-stable-ui-text.json'),
    `${JSON.stringify(stableReport, null, 2)}\n`,
    'utf8'
);
fs.writeFileSync(
    path.join(outputDir, 'discovered-dynamic-content-exclusions.json'),
    `${JSON.stringify(dynamicReport, null, 2)}\n`,
    'utf8'
);
fs.writeFileSync(
    path.join(outputDir, 'discovered-false-positives.json'),
    `${JSON.stringify(falsePositiveReport, null, 2)}\n`,
    'utf8'
);

const markdownRows = stableCandidates.slice(0, 250).map((candidate) => [
    `| ${candidate.risk}`,
    `\`${candidate.file}:${candidate.line}\``,
    candidate.classification,
    escapeMarkdownTableCell(candidate.detectedText),
    candidate.suggestedIcuId,
    escapeMarkdownTableCell(candidate.reason),
    '|',
].join(' | '));

const markdown = [
    '# Discovered Stable UI Text',
    '',
    `Generated: ${stableSummary.generatedAt}`,
    '',
    '## Summary',
    '',
    `- Files scanned: ${stableSummary.filesScanned}`,
    `- Stable candidates: ${stableSummary.stableCandidates}`,
    `- High risk: ${stableSummary.byRisk.high || 0}`,
    `- Medium risk: ${stableSummary.byRisk.medium || 0}`,
    `- Low risk: ${stableSummary.byRisk.low || 0}`,
    `- Dynamic exclusions: ${stableSummary.dynamicExclusions}`,
    `- False positives / non-production exclusions: ${stableSummary.falsePositives}`,
    `- Parse errors: ${stableSummary.parseErrors}`,
    '',
    '## Stable Candidates',
    '',
    '| Risk | Location | Classification | Text | Suggested ICU ID | Reason |',
    '| --- | --- | --- | --- | --- | --- |',
    ...markdownRows,
    stableCandidates.length > markdownRows.length
        ? `| low | ... | ... | ${stableCandidates.length - markdownRows.length} more candidates in JSON report | ... | ... |`
        : '',
    '',
].filter(Boolean).join('\n');

fs.writeFileSync(path.join(outputDir, 'discovered-stable-ui-text.md'), markdown, 'utf8');

console.log(`Stable UI text discovery scanned ${files.length} files.`);
console.log(`Stable candidates: ${stableSummary.stableCandidates}`);
console.log(`High risk: ${stableSummary.byRisk.high || 0}; medium: ${stableSummary.byRisk.medium || 0}; low: ${stableSummary.byRisk.low || 0}`);
console.log(`Dynamic exclusions: ${stableSummary.dynamicExclusions}`);
console.log(`False positives / non-production exclusions: ${stableSummary.falsePositives}`);
console.log('Report: artifacts/i18n/discovered-stable-ui-text.md');

if (parseErrors.length > 0) {
    console.warn(`Parse errors: ${parseErrors.length}`);
}

if (checkMode) {
    const blocking = stableCandidates.filter((candidate) => (
        !candidate.alreadyCoveredByIcu
    ));
    if (blocking.length > 0) {
        console.error(`Stable UI text discovery guard failed with ${blocking.length} blocking candidates.`);
        process.exitCode = 1;
    }
}
