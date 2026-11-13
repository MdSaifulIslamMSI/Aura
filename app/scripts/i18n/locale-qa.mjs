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
const humanReviewQueueKeys = new Set();
humanReviewQueue.forEach((entry) => {
    const targets = Array.isArray(entry.targets) ? entry.targets : [entry];
    targets.forEach((target) => {
        const ids = Array.isArray(target.ids) ? target.ids : [target.id].filter(Boolean);
        ids.forEach((id) => humanReviewQueueKeys.add(`${target.locale}\u0000${id}`));
    });
});

const MOJIBAKE_PATTERN = /\uFFFD|Ã|Â|â€™|â€œ|â€|ï¿½/;
const QUESTION_MARK_CORRUPTION_PATTERN = /\p{L}\?+\p{L}|\?{2,}/u;
const URL_PATTERN = /https?:\/\/\S+/g;
const NON_LATIN_SCRIPT_RULES = {
    ar: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/,
    as: /[\u0980-\u09FF]/,
    bn: /[\u0980-\u09FF]/,
    gu: /[\u0A80-\u0AFF]/,
    hi: /[\u0900-\u097F]/,
    ja: /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/,
    kn: /[\u0C80-\u0CFF]/,
    ml: /[\u0D00-\u0D7F]/,
    mr: /[\u0900-\u097F]/,
    or: /[\u0B00-\u0B7F]/,
    pa: /[\u0A00-\u0A7F]/,
    sa: /[\u0900-\u097F]/,
    te: /[\u0C00-\u0C7F]/,
    ur: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/,
    zh: /[\u4E00-\u9FFF]/,
};
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CLI_CMD_PATTERN = /\bnpm\s+run\s+[a-z0-9:_-]+/gi;
const PHONE_MASK_PATTERN = /\b98X+\b/g;
const stripPlaceholdersAndUrls = (value = '') => String(value || '')
    .replace(URL_PATTERN, ' ')
    .replace(EMAIL_PATTERN, ' ')
    .replace(CLI_CMD_PATTERN, ' ')
    .replace(PHONE_MASK_PATTERN, ' ')
    .replace(/\{[A-Za-z0-9_]+\}/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .trim();
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

        const cleanedForCorruption = stripPlaceholdersAndUrls(translatedMessage);
        const cleanedEnglishForCorruption = stripPlaceholdersAndUrls(sourceMessage);
        const hasCorruptedSpaceQuestion = /[₹—–•·]|[^\x00-\x7F]/.test(cleanedEnglishForCorruption)
            && !cleanedEnglishForCorruption.includes('?')
            && /(?:^|\s)\?(?:\s|$)/.test(cleanedForCorruption);
        if (
            MOJIBAKE_PATTERN.test(translatedMessage)
            || QUESTION_MARK_CORRUPTION_PATTERN.test(cleanedForCorruption)
            || hasCorruptedSpaceQuestion
        ) {
            pushIssue(locale, id, 'mojibake', 'Message contains broken encoding or ?-substitution glyphs.');
        }

        const isAllowlistedExact = qaRules.englishLeakageAllowlist.includes(sourceMessage)
            && translatedMessage === sourceMessage;
        const nativeScriptRegex = NON_LATIN_SCRIPT_RULES[locale];
        if (nativeScriptRegex && !isAllowlistedExact) {
            const allowlistPattern = qaRules.englishLeakageAllowlist
                .filter((item) => item && !/[{}@]/.test(item))
                .sort((a, b) => b.length - a.length)
                .map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                .join('|');
            const withoutAllowlist = allowlistPattern
                ? cleanedForCorruption.replace(new RegExp(`\\b(?:${allowlistPattern})\\b`, 'gi'), ' ')
                : cleanedForCorruption;
            const withoutTechnicalTokens = withoutAllowlist
                .replace(/\b(?:Aura|Razorpay|Stripe|Vercel|Netlify|CloudFront|Render|LiveKit|Gemma|Gemini|Google|GitHub|WebAuthn|Passkey|Whisper|Android|iOS|HTTP|HTTPS|JSON|CSV|PDF|OTP|UPI|EMI|COD|INR|USD|API|SDK|URL|SLA|FAQ|SMS|PIN|CPU|GPU|RAM|USB|WiFi|OK)\b/gi, ' ')
                .replace(/\b[A-Z]{2,6}\b/g, ' ')
                .trim();
            if (!nativeScriptRegex.test(withoutTechnicalTokens) && /[a-z]{3,}/i.test(withoutTechnicalTokens)) {
                pushIssue(locale, id, 'romanized-leakage', 'Non-Latin locale entry has no native script characters and contains Romanized text.');
            }
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
