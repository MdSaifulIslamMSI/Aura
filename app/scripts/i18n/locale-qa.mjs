import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    TYPE,
    isStructurallySame,
    parse,
} from '@formatjs/icu-messageformat-parser';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '../..');
const repoDir = path.resolve(appDir, '..');
const reviewedDir = path.join(appDir, 'src/i18n/messages/reviewed');
const qualityDir = path.join(appDir, 'src/i18n/quality');
const glossaryDir = path.join(appDir, 'src/i18n/glossary');
const outputDir = path.join(repoDir, 'artifacts/i18n');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const requiredLocales = readJson(path.join(qualityDir, 'requiredLocales.json'));
const localeManifest = readJson(path.join(qualityDir, 'localeManifest.json'));
const qaRules = readJson(path.join(qualityDir, 'qaRules.json'));
const brandTerms = readJson(path.join(glossaryDir, 'brand-terms.json'));
const forbiddenTransliterations = readJson(path.join(glossaryDir, 'forbidden-transliterations.json'));
const sourceMessages = readJson(path.join(reviewedDir, 'en.json'));
const humanReviewQueuePath = path.join(qualityDir, 'humanReviewQueue.json');
const humanReviewQueue = fs.existsSync(humanReviewQueuePath) ? readJson(humanReviewQueuePath) : [];
const humanReviewQueueKeys = new Set(humanReviewQueue.map(({ id, locale }) => `${locale}\u0000${id}`));

const MOJIBAKE_PATTERN = /\uFFFD|Ã|Â|â€™|â€œ|â€|ï¿½/;
const RAW_HTML_RISK_PATTERN = /<script\b|javascript:|on[a-z]+\s*=/i;
const COMPACT_ID_PATTERN = /^(nav|auth|checkout|common|status)\./;

const issues = [];
const warnings = [];
const pushIssue = (locale, id, code, detail) => issues.push({ locale, id, code, detail });
const pushWarning = (locale, id, code, detail) => warnings.push({ locale, id, code, detail });

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

for (const locale of requiredLocales) {
    const localePath = path.join(reviewedDir, `${locale}.json`);
    const manifest = localeManifest[locale];
    if (!manifest) {
        pushIssue(locale, '', 'missing-manifest-entry', 'Locale is required but has no manifest entry.');
        continue;
    }

    const shouldBeRtl = qaRules.rtlLocales.includes(locale);
    if ((manifest.direction === 'rtl') !== shouldBeRtl) {
        pushIssue(locale, '', 'invalid-direction', `Expected direction ${shouldBeRtl ? 'rtl' : 'ltr'}.`);
    }

    if (!fs.existsSync(localePath)) {
        pushIssue(locale, '', 'missing-locale-file', 'Required reviewed locale catalog is missing.');
        continue;
    }

    const messages = readJson(localePath);
    const sourceIds = Object.keys(sourceMessages);
    const localeIds = Object.keys(messages);

    sourceIds.forEach((id) => {
        const sourceMessage = sourceMessages[id];
        const translatedMessage = messages[id];
        if (typeof translatedMessage !== 'string' || translatedMessage.trim() === '') {
            pushIssue(locale, id, 'missing-message', 'Required message is missing or empty.');
            return;
        }

        if (MOJIBAKE_PATTERN.test(translatedMessage)) {
            pushIssue(locale, id, 'mojibake', 'Message contains a known broken-encoding marker.');
        }

        if (RAW_HTML_RISK_PATTERN.test(translatedMessage)) {
            pushIssue(locale, id, 'raw-html-risk', 'Message contains unsafe HTML-like content.');
        }

        let sourceAst;
        let translatedAst;
        try {
            sourceAst = parse(sourceMessage);
            translatedAst = parse(translatedMessage);
        } catch (error) {
            pushIssue(locale, id, 'invalid-icu', error.message);
            return;
        }

        const structuralResult = isStructurallySame(sourceAst, translatedAst);
        if (!structuralResult.success) {
            pushIssue(locale, id, 'icu-structure-mismatch', structuralResult.error.message);
        }

        visitAst(translatedAst, (element) => {
            if ((element.type === TYPE.plural || element.type === TYPE.select) && !element.options.other) {
                pushIssue(locale, id, 'missing-other-branch', 'Plural/select message must include an other branch.');
            }
        });

        if (
            locale !== 'en'
            && locale !== 'en-XA'
            && sourceMessage === translatedMessage
            && !qaRules.englishLeakageAllowlist.includes(sourceMessage)
        ) {
            if (humanReviewQueueKeys.has(`${locale}\u0000${id}`)) {
                pushWarning(locale, id, 'queued-english-fallback', 'Human-review queue tracks this English fallback.');
            } else {
                pushIssue(locale, id, 'english-leakage', 'Reviewed translation is identical to English source.');
            }
        }

        if (
            COMPACT_ID_PATTERN.test(id)
            && translatedMessage.length > sourceMessage.length * qaRules.maxCompactExpansionRatio
        ) {
            pushWarning(locale, id, 'compact-expansion-risk', 'Compact UI message may require layout review.');
        }

        Object.entries(brandTerms).forEach(([term, rule]) => {
            if (rule.doNotTranslate && sourceMessage.includes(term) && !translatedMessage.includes(term)) {
                pushIssue(locale, id, 'brand-term-corruption', `Required brand term is missing: ${term}.`);
            }
        });

        Object.entries(forbiddenTransliterations).forEach(([term, translations]) => {
            translations.forEach((translation) => {
                if (translatedMessage.includes(translation)) {
                    pushIssue(locale, id, 'forbidden-transliteration', `Use the approved brand term instead of ${translation} for ${term}.`);
                }
            });
        });
    });

    localeIds
        .filter((id) => !Object.prototype.hasOwnProperty.call(sourceMessages, id))
        .forEach((id) => pushWarning(locale, id, 'extra-message', 'Locale contains a message not present in English source.'));
}

const report = {
    generatedAt: new Date().toISOString(),
    issueCount: issues.length,
    issues,
    requiredLocales,
    sourceMessageCount: Object.keys(sourceMessages).length,
    warningCount: warnings.length,
    warnings,
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'locale-qa-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
fs.writeFileSync(path.join(outputDir, 'locale-qa-report.md'), [
    '# Locale QA Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Critical issues: ${report.issueCount}`,
    `Warnings: ${report.warningCount}`,
    `Required locales: ${requiredLocales.join(', ')}`,
    '',
    ...issues.map((issue) => `- ERROR [${issue.locale}] ${issue.id || '(locale)'} ${issue.code}: ${issue.detail}`),
    ...warnings.map((warning) => `- WARN [${warning.locale}] ${warning.id || '(locale)'} ${warning.code}: ${warning.detail}`),
    '',
].join('\n'), 'utf8');

console.log(`Locale QA checked ${requiredLocales.length} locale catalogs and ${Object.keys(sourceMessages).length} ICU messages.`);
console.log(`Critical issues: ${issues.length}`);
console.log(`Warnings: ${warnings.length}`);
console.log(`Report: ${path.relative(repoDir, outputDir).replace(/\\/g, '/')}/locale-qa-report.md`);

if (issues.length > 0) {
    process.exit(1);
}
