import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '../..');
const appDir = path.join(repoDir, 'app');
const reviewedDir = path.join(appDir, 'src/i18n/messages/reviewed');
const outputDir = path.join(repoDir, 'artifacts/i18n');
const languageQualityDocPath = path.join(repoDir, 'docs/localization-language-quality.md');

const appRequire = createRequire(path.join(appDir, 'package.json'));
const {
    TYPE,
    isStructurallySame,
    parse,
} = appRequire('@formatjs/icu-messageformat-parser');

const LETTER_PATTERN = /\p{Letter}/gu;
const PLACEHOLDER_PATTERN = /\{\{\s*[^}]+\s*\}\}|__AURA_PLACEHOLDER_\d+__/g;
const MOJIBAKE_PATTERN = /\uFFFD|Ã|Â|â€™|â€œ|â€|ï¿½/;
const RAW_HTML_RISK_PATTERN = /<script\b|javascript:|on[a-z]+\s*=/i;
const MIN_NATIVE_TRANSLATED_LETTER_PERCENT = 60;

const NATIVE_SCRIPT_RULES = {
    ar: { label: 'Arabic', patterns: [/\p{Script=Arabic}/u] },
    as: { label: 'Bengali', patterns: [/\p{Script=Bengali}/u] },
    bn: { label: 'Bengali', patterns: [/\p{Script=Bengali}/u] },
    gu: { label: 'Gujarati', patterns: [/\p{Script=Gujarati}/u] },
    hi: { label: 'Devanagari', patterns: [/\p{Script=Devanagari}/u] },
    ja: {
        label: 'Japanese',
        patterns: [
            /\p{Script=Hiragana}/u,
            /\p{Script=Katakana}/u,
            /\p{Script=Han}/u,
        ],
    },
    kn: { label: 'Kannada', patterns: [/\p{Script=Kannada}/u] },
    ml: { label: 'Malayalam', patterns: [/\p{Script=Malayalam}/u] },
    mr: { label: 'Devanagari', patterns: [/\p{Script=Devanagari}/u] },
    or: { label: 'Odia', patterns: [/\p{Script=Oriya}/u] },
    pa: { label: 'Gurmukhi', patterns: [/\p{Script=Gurmukhi}/u] },
    sa: { label: 'Devanagari', patterns: [/\p{Script=Devanagari}/u] },
    te: { label: 'Telugu', patterns: [/\p{Script=Telugu}/u] },
    ur: { label: 'Arabic', patterns: [/\p{Script=Arabic}/u] },
    zh: { label: 'Han', patterns: [/\p{Script=Han}/u] },
};

const readJson = (relativePath) => {
    const absolutePath = path.join(repoDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Missing required JSON file: ${relativePath}`);
    }
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
};

const requiredLocales = readJson('app/src/i18n/quality/requiredLocales.json');
const localeManifest = readJson('app/src/i18n/quality/localeManifest.json');
const qaRules = readJson('app/src/i18n/quality/qaRules.json');
const brandTerms = readJson('app/src/i18n/glossary/brand-terms.json');
const forbiddenTransliterations = readJson('app/src/i18n/glossary/forbidden-transliterations.json');
const sourceMessages = readJson('app/src/i18n/messages/reviewed/en.json');
const humanReviewQueue = readJson('app/src/i18n/quality/humanReviewQueue.json');
const nativeReviewAudit = readJson('app/src/i18n/quality/nativeReviewAudit.json');
const discoveredStableText = readJson('artifacts/i18n/discovered-stable-ui-text.json');

const ensureArray = (value) => (Array.isArray(value) ? value : []);
const stripQualityNoise = (value = '') => String(value)
    .replace(PLACEHOLDER_PATTERN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const formatPercent = (value) => (Number.isFinite(value) ? `${value.toFixed(1)}%` : 'n/a');
const formatCsvPercent = (value) => (Number.isFinite(value) ? value.toFixed(2) : '');
const formatNativeLetterCell = (percent, nativeCount, totalCount) => {
    if (totalCount === 0) return 'n/a (0 messages)';
    return `${formatPercent(percent)} (${nativeCount}/${totalCount})`;
};
const csvCell = (value) => {
    const text = value == null ? '' : String(value);
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
};

const parseArgs = (argv) => {
    const parsedArgs = {};
    argv.forEach((arg) => {
        if (!arg.startsWith('--')) return;
        const [key, ...valueParts] = arg.slice(2).split('=');
        parsedArgs[key] = valueParts.length > 0 ? valueParts.join('=') : true;
    });
    return parsedArgs;
};

const args = parseArgs(process.argv.slice(2));
const finalMode = Boolean(args.final);

const expandReviewPairs = (units) => {
    const pairs = [];
    ensureArray(units).forEach((entry) => {
        ensureArray(entry.targets).forEach((target) => {
            ensureArray(target.ids).forEach((id) => {
                pairs.push({
                    id,
                    locale: target.locale,
                    reason: entry.reason,
                    risk: target.risk || entry.risk || 'low',
                });
            });
        });
    });
    return pairs;
};

const countPairsByLocale = (pairs) => pairs.reduce((acc, pair) => {
    acc[pair.locale] = (acc[pair.locale] || 0) + 1;
    return acc;
}, {});

const createPairSet = (pairs) => new Set(pairs.map((pair) => `${pair.locale}\u0000${pair.id}`));

const countLetters = (value) => (String(value).match(LETTER_PATTERN) || []).length;
const countNativeLetters = (value, patterns) => {
    const letters = String(value).match(LETTER_PATTERN) || [];
    return letters.filter((letter) => patterns.some((pattern) => pattern.test(letter))).length;
};

const visitAst = (ast = [], visitor) => {
    ast.forEach((element) => {
        visitor(element);
        if (element.type === TYPE.plural || element.type === TYPE.select) {
            Object.values(element.options).forEach((option) => visitAst(option.value, visitor));
        }
        if (element.type === TYPE.tag) {
            visitAst(element.children, visitor);
        }
    });
};

const astToQualityText = (ast = []) => {
    const chunks = [];
    visitAst(ast, (element) => {
        if (element.type === TYPE.literal && element.value) {
            chunks.push(element.value);
        }
    });
    return stripQualityNoise(chunks.join(' '));
};

const actionablePairs = expandReviewPairs(humanReviewQueue);
const nativeAuditPairs = expandReviewPairs(nativeReviewAudit);
const actionableByLocale = countPairsByLocale(actionablePairs);
const nativeAuditByLocale = countPairsByLocale(nativeAuditPairs);
const actionablePairSet = createPairSet(actionablePairs);
const trackedReviewPairSet = createPairSet([...actionablePairs, ...nativeAuditPairs]);
const sourceIds = Object.keys(sourceMessages).sort((left, right) => left.localeCompare(right));
const allowlistedEnglishMessages = new Set(qaRules.englishLeakageAllowlist || []);
const stableUiCandidates = ensureArray(discoveredStableText.candidates);
const uncoveredStableUiCandidates = stableUiCandidates.filter((candidate) => !candidate.alreadyCoveredByIcu);

const rows = [];
const blockingIssues = [];

if (uncoveredStableUiCandidates.length > 0) {
    blockingIssues.push({
        code: 'uncovered-stable-ui-candidates',
        count: uncoveredStableUiCandidates.length,
        locale: 'all',
    });
}

for (const locale of requiredLocales) {
    const localePath = path.join(reviewedDir, `${locale}.json`);
    const manifest = localeManifest[locale] || {};
    const nativeRule = NATIVE_SCRIPT_RULES[locale];
    const row = {
        actionableReviewPairs: actionableByLocale[locale] || 0,
        allowedExactEnglish: 0,
        brandTermCorruption: 0,
        confirmedNativeLetterPercent: null,
        direction: manifest.direction || '',
        directionIssues: 0,
        emptyMessages: 0,
        exactEnglishFallbacks: 0,
        forbiddenTransliterations: 0,
        invalidIcu: 0,
        locale,
        mechanicalIssues: 0,
        missingMessages: 0,
        mojibake: 0,
        nativeAuditPairs: nativeAuditByLocale[locale] || 0,
        nativeLetterPercent: null,
        nativeScriptIssues: 0,
        nativeRule: nativeRule?.label || '',
        nativeTranslatedLetterPercent: null,
        rawHtmlRisk: 0,
        requiredMessages: sourceIds.length,
        status: 'PASS',
        structuralMismatches: 0,
        confirmedMessagesWithNativeScript: 0,
        confirmedTranslatedMessages: 0,
        translatedMessagesWithNativeScript: 0,
        translatedMessagesWithoutFallback: 0,
        untrackedEnglishFallbacks: 0,
    };

    const shouldBeRtl = ensureArray(qaRules.rtlLocales).includes(locale);
    if ((manifest.direction === 'rtl') !== shouldBeRtl) {
        row.directionIssues += 1;
    }

    if (!fs.existsSync(localePath)) {
        row.missingMessages = sourceIds.length;
        row.mechanicalIssues += row.missingMessages + row.directionIssues;
        row.status = 'FAIL';
        blockingIssues.push({ code: 'missing-locale-file', count: sourceIds.length, locale });
        rows.push(row);
        continue;
    }

    const messages = JSON.parse(fs.readFileSync(localePath, 'utf8'));
    let nativeLetters = 0;
    let totalLetters = 0;
    let translatedNativeLetters = 0;
    let translatedTotalLetters = 0;
    let confirmedNativeLetters = 0;
    let confirmedTotalLetters = 0;

    sourceIds.forEach((id) => {
        const localeId = `${locale}\u0000${id}`;
        const sourceMessage = sourceMessages[id];
        const translatedMessage = messages[id];
        if (typeof translatedMessage !== 'string') {
            row.missingMessages += 1;
            return;
        }
        if (translatedMessage.trim() === '') {
            row.emptyMessages += 1;
            return;
        }

        if (MOJIBAKE_PATTERN.test(translatedMessage)) row.mojibake += 1;
        if (RAW_HTML_RISK_PATTERN.test(translatedMessage)) row.rawHtmlRisk += 1;

        let sourceAst;
        let translatedAst;
        try {
            sourceAst = parse(sourceMessage);
            translatedAst = parse(translatedMessage);
        } catch {
            row.invalidIcu += 1;
            return;
        }

        const structuralResult = isStructurallySame(sourceAst, translatedAst);
        if (!structuralResult.success) row.structuralMismatches += 1;

        visitAst(translatedAst, (element) => {
            if ((element.type === TYPE.plural || element.type === TYPE.select) && !element.options.other) {
                row.structuralMismatches += 1;
            }
        });

        const sourceQualityText = astToQualityText(sourceAst);
        const translatedQualityText = astToQualityText(translatedAst);
        const normalizedSource = sourceQualityText.toLocaleLowerCase('en-US');
        const normalizedTranslation = translatedQualityText.toLocaleLowerCase('en-US');
        const isAllowedExactEnglish = allowlistedEnglishMessages.has(sourceMessage);
        const isExactEnglishFallback = locale !== 'en'
            && locale !== 'en-XA'
            && normalizedSource
            && normalizedSource === normalizedTranslation
            && !isAllowedExactEnglish;

        if (locale !== 'en' && locale !== 'en-XA' && normalizedSource === normalizedTranslation && isAllowedExactEnglish) {
            row.allowedExactEnglish += 1;
        }

        if (isExactEnglishFallback) {
            row.exactEnglishFallbacks += 1;
            if (!actionablePairSet.has(localeId) && !trackedReviewPairSet.has(localeId)) {
                row.untrackedEnglishFallbacks += 1;
            }
        }

        Object.entries(brandTerms).forEach(([term, rule]) => {
            if (rule.doNotTranslate && sourceMessage.includes(term) && !translatedMessage.includes(term)) {
                row.brandTermCorruption += 1;
            }
        });

        Object.values(forbiddenTransliterations).flat().forEach((translation) => {
            if (translatedMessage.includes(translation)) {
                row.forbiddenTransliterations += 1;
            }
        });

        if (nativeRule) {
            const letters = countLetters(translatedQualityText);
            const nativeLetterCount = countNativeLetters(translatedQualityText, nativeRule.patterns);
            totalLetters += letters;
            nativeLetters += nativeLetterCount;

            if (!isExactEnglishFallback && translatedQualityText && translatedQualityText !== sourceQualityText) {
                row.translatedMessagesWithoutFallback += 1;
                translatedTotalLetters += letters;
                translatedNativeLetters += nativeLetterCount;
                if (nativeLetterCount > 0) row.translatedMessagesWithNativeScript += 1;

                if (!trackedReviewPairSet.has(localeId)) {
                    row.confirmedTranslatedMessages += 1;
                    confirmedTotalLetters += letters;
                    confirmedNativeLetters += nativeLetterCount;
                    if (nativeLetterCount > 0) row.confirmedMessagesWithNativeScript += 1;
                }
            }
        }

    });

    row.nativeLetterPercent = nativeRule && totalLetters > 0
        ? (nativeLetters / totalLetters) * 100
        : null;
    row.nativeTranslatedLetterPercent = nativeRule && translatedTotalLetters > 0
        ? (translatedNativeLetters / translatedTotalLetters) * 100
        : null;
    row.confirmedNativeLetterPercent = nativeRule && confirmedTotalLetters > 0
        ? (confirmedNativeLetters / confirmedTotalLetters) * 100
        : null;

    if (
        nativeRule
        && row.confirmedTranslatedMessages > 0
        && row.confirmedNativeLetterPercent < MIN_NATIVE_TRANSLATED_LETTER_PERCENT
    ) {
        row.nativeScriptIssues += 1;
    }

    row.mechanicalIssues = row.directionIssues
        + row.missingMessages
        + row.emptyMessages
        + row.invalidIcu
        + row.structuralMismatches
        + row.mojibake
        + row.rawHtmlRisk
        + row.untrackedEnglishFallbacks
        + row.brandTermCorruption
        + row.forbiddenTransliterations
        + row.nativeScriptIssues;

    row.status = row.mechanicalIssues > 0 ? 'FAIL' : 'PASS';

    if (row.mechanicalIssues > 0) {
        blockingIssues.push({
            code: 'locale-quality-mechanical-failure',
            count: row.mechanicalIssues,
            locale,
        });
    }

    rows.push(row);
}

const nativeStatusForRow = (row) => {
    if (row.locale === 'en') return 'source';
    if (row.locale === 'en-XA') return 'pseudo-locale';
    if (row.actionableReviewPairs > 0) return 'translation-repair-required';
    if (row.nativeAuditPairs > 0) return 'native-signoff-required';
    return 'native-clear';
};

const finalQualityStatusForRow = (row) => {
    if (row.locale === 'en') return 'SOURCE';
    if (row.locale === 'en-XA') return 'PSEUDO_LOCALE';
    if (
        row.status === 'PASS'
        && row.exactEnglishFallbacks === 0
        && row.actionableReviewPairs === 0
        && row.nativeAuditPairs === 0
    ) {
        return 'FINAL_READY';
    }
    return 'NOT_FINAL';
};

const rowsWithStatus = rows.map((row) => ({
    ...row,
    finalQualityStatus: finalQualityStatusForRow(row),
    nativeStatus: nativeStatusForRow(row),
}));
const finalQualityFailures = rowsWithStatus.filter((row) => row.finalQualityStatus === 'NOT_FINAL');

if (finalMode && finalQualityFailures.length > 0) {
    blockingIssues.push({
        code: 'final-native-quality-not-ready',
        count: finalQualityFailures.length,
        locale: 'all',
    });
}

const summary = {
    generatedAt: new Date().toISOString(),
    blockingIssueCount: blockingIssues.length,
    blockingIssues,
    finalMode,
    finalQualityFailures: finalQualityFailures.length,
    requiredLocales: requiredLocales.length,
    sourceMessageKeys: sourceIds.length,
    stableUiCandidates: stableUiCandidates.length,
    uncoveredStableUiCandidates: uncoveredStableUiCandidates.length,
    totalActionableReviewPairs: actionablePairs.length,
    totalNativeAuditPairs: nativeAuditPairs.length,
    rows: rowsWithStatus,
};

const csvLines = [
    [
        'locale',
        'mechanical_gate',
        'native_status',
        'final_quality_status',
        'required_messages',
        'mechanical_issues',
        'missing_messages',
        'empty_messages',
        'invalid_icu',
        'structural_mismatches',
        'mojibake',
        'unsafe_html',
        'native_script_issues',
        'exact_english_fallbacks',
        'untracked_english_fallbacks',
        'actionable_review_pairs',
        'native_audit_pairs',
        'native_rule',
        'native_letters_percent_all_text',
        'native_letters_percent_translated_text',
        'native_letters_percent_confirmed_text',
        'translated_messages_with_native_script',
        'translated_messages_without_fallback',
        'confirmed_messages_with_native_script',
        'confirmed_translated_messages',
    ].join(','),
    ...summary.rows.map((row) => [
        row.locale,
        row.status,
        row.nativeStatus,
        row.finalQualityStatus,
        row.requiredMessages,
        row.mechanicalIssues,
        row.missingMessages,
        row.emptyMessages,
        row.invalidIcu,
        row.structuralMismatches,
        row.mojibake,
        row.rawHtmlRisk,
        row.nativeScriptIssues,
        row.exactEnglishFallbacks,
        row.untrackedEnglishFallbacks,
        row.actionableReviewPairs,
        row.nativeAuditPairs,
        row.nativeRule,
        formatCsvPercent(row.nativeLetterPercent),
        formatCsvPercent(row.nativeTranslatedLetterPercent),
        formatCsvPercent(row.confirmedNativeLetterPercent),
        row.translatedMessagesWithNativeScript,
        row.translatedMessagesWithoutFallback,
        row.confirmedMessagesWithNativeScript,
        row.confirmedTranslatedMessages,
    ].map(csvCell).join(',')),
];

const docLines = [
    '# Localization Language Quality',
    '',
    'This report is the per-language quality gate for the reviewed ICU catalog system. It certifies mechanical translation safety and keeps native-language signoff visible instead of hiding it behind a single coverage percentage.',
    '',
    '## Gate Rules',
    '',
    '- Every required locale must contain every required ICU message.',
    '- ICU syntax and source/translation placeholder structure must match.',
    '- Unsafe HTML-like content, mojibake, corrupted brand terms, and forbidden transliterations are blocking.',
    '- Exact English fallback is blocking unless the locale/message pair is explicitly tracked in the actionable queue or native-review audit.',
    '- Native-script locales must keep confirmed translated non-fallback text above the native-letter floor; text still in actionable/native review is reported but not hidden as certified.',
    '',
    '## Summary',
    '',
    `- Required locales: ${summary.requiredLocales}`,
    `- Source ICU message keys: ${summary.sourceMessageKeys}`,
    `- Stable UI scanner candidates: ${summary.stableUiCandidates}`,
    `- Uncovered stable UI scanner candidates: ${summary.uncoveredStableUiCandidates}`,
    `- Blocking mechanical quality rows: ${summary.rows.filter((row) => row.status === 'FAIL').length}`,
    `- Final native-quality rows not ready: ${summary.finalQualityFailures}`,
    `- Actionable review pairs tracked: ${summary.totalActionableReviewPairs}`,
    `- Native signoff pairs tracked: ${summary.totalNativeAuditPairs}`,
    '',
    '## Per-Language Status',
    '',
    '| Locale | Mechanical gate | Final quality | Native status | Required messages | Exact English fallbacks | Untracked fallbacks | Actionable review pairs | Native audit pairs | Native letters, translated non-fallback text | Native letters, confirmed text |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |',
    ...summary.rows.map((row) => [
        '|',
        row.locale,
        '|',
        row.status,
        '|',
        row.finalQualityStatus,
        '|',
        row.nativeStatus,
        '|',
        row.requiredMessages,
        '|',
        row.exactEnglishFallbacks,
        '|',
        row.untrackedEnglishFallbacks,
        '|',
        row.actionableReviewPairs,
        '|',
        row.nativeAuditPairs,
        '|',
        row.nativeRule
            ? formatNativeLetterCell(row.nativeTranslatedLetterPercent, row.translatedMessagesWithNativeScript, row.translatedMessagesWithoutFallback)
            : 'n/a',
        '|',
        row.nativeRule
            ? formatNativeLetterCell(row.confirmedNativeLetterPercent, row.confirmedMessagesWithNativeScript, row.confirmedTranslatedMessages)
            : 'n/a',
        '|',
    ].join(' ')),
    '',
    '## Interpretation',
    '',
    '- `PASS` means the locale is mechanically safe: complete catalog, valid ICU, matching placeholders, no unsafe content, no mojibake, and no hidden English fallback.',
    '- `FINAL_READY` means the locale has no exact English fallback, no actionable repair queue, and no native audit signoff debt.',
    '- `NOT_FINAL` means the locale is safe to ship mechanically but is not native-quality complete.',
    '- `translation-repair-required` means the locale still has explicit English fallback debt in `humanReviewQueue.json`.',
    '- `native-signoff-required` means promoted legacy/foundation translations are structurally safe but still need native linguistic signoff.',
    '- `n/a (0 messages)` in the confirmed-text column means that no non-fallback messages have graduated out of the actionable/native-audit queues for that native-script locale yet; it is a zero-denominator signoff status, not missing key coverage.',
    '- Run `npm run i18n:language-quality -- --final` when final native-quality release certification must block on all remaining repair/signoff debt.',
    '- This is stronger than the legacy market-pack quality audit because it covers the full reviewed ICU catalog surface, not only the 599-key legacy pack.',
    '',
    'Machine-readable report: `artifacts/i18n/language-quality-report.json`.',
    '',
].join('\n');

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(languageQualityDocPath), { recursive: true });
fs.writeFileSync(path.join(outputDir, 'language-quality-report.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
fs.writeFileSync(path.join(outputDir, 'language-quality-report.csv'), `${csvLines.join('\n')}\n`, 'utf8');
fs.writeFileSync(languageQualityDocPath, docLines, 'utf8');

console.log('Reviewed ICU language quality audit');
console.log(`Required locales: ${summary.requiredLocales}`);
console.log(`Source ICU message keys: ${summary.sourceMessageKeys}`);
console.log(`Stable UI scanner candidates: ${summary.stableUiCandidates}`);
console.log(`Uncovered stable UI scanner candidates: ${summary.uncoveredStableUiCandidates}`);
console.log(`Blocking mechanical quality rows: ${summary.rows.filter((row) => row.status === 'FAIL').length}`);
console.log(`Final native-quality rows not ready: ${summary.finalQualityFailures}`);
summary.rows.forEach((row) => {
    console.log(
        `- ${row.locale}: mechanical ${row.status} | final ${row.finalQualityStatus} | ${row.nativeStatus} | `
        + `${row.exactEnglishFallbacks} exact English fallback(s), `
        + `${row.untrackedEnglishFallbacks} untracked, `
        + `${row.actionableReviewPairs} actionable pair(s), `
        + `${row.nativeAuditPairs} native audit pair(s)`
        + (row.nativeRule
            ? ` | ${row.nativeRule} translated letters ${formatNativeLetterCell(row.nativeTranslatedLetterPercent, row.translatedMessagesWithNativeScript, row.translatedMessagesWithoutFallback)}`
                + ` | confirmed letters ${formatNativeLetterCell(row.confirmedNativeLetterPercent, row.confirmedMessagesWithNativeScript, row.confirmedTranslatedMessages)}`
            : '')
    );
});
console.log('Report: docs/localization-language-quality.md');

if (blockingIssues.length > 0) {
    process.exit(1);
}
