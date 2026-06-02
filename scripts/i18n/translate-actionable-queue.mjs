import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(scriptDir, '../..');
const appDir = path.join(repoDir, 'app');
const reviewedDir = path.join(appDir, 'src/i18n/messages/reviewed');
const outputDir = path.join(repoDir, 'artifacts/i18n');

const appRequire = createRequire(path.join(appDir, 'package.json'));
const {
    TYPE,
    isStructurallySame,
    parse,
} = appRequire('@formatjs/icu-messageformat-parser');
const { printAST } = await import(pathToFileURL(
    path.join(appDir, 'node_modules/@formatjs/icu-messageformat-parser/printer.js')
).href);

const DEFAULT_OUTPUT = path.join(outputDir, 'free-translation-candidates.jsonl');
const MOJIBAKE_PATTERN = /\uFFFD|Ã|Â|â€™|â€œ|â€|ï¿½/;
const RAW_HTML_RISK_PATTERN = /<script\b|javascript:|on[a-z]+\s*=/i;
const LETTER_PATTERN = /\p{Letter}/u;
const BAD_MACHINE_TRANSLATION_PATTERN = /\b(comitar|comito)\b/i;
const PROMPT_LEAKAGE_PATTERN = /\b(return only|preserve|do not add|markdown|quotation marks|translated text|ecommerce UI text|regresar solo|preservar|no agregar|marcadores ICU|explicaciones|etiquetas|comillas)\b/i;
const PLACEHOLDER_TOKEN_PATTERN = /\{[^}]+\}/g;
const ENGLISH_LEAKAGE_ALLOWLIST = new Set([
    'aura',
    'commit',
    'email',
    'id',
    'otp',
    'upi',
    'url',
]);
const RISK_ORDER = { high: 0, medium: 1, low: 2 };
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
const TARGET_NAMES = {
    ar: 'Arabic',
    as: 'Assamese',
    bn: 'Bengali',
    de: 'German',
    es: 'Spanish',
    fr: 'French',
    gu: 'Gujarati',
    hi: 'Hindi',
    ja: 'Japanese',
    kn: 'Kannada',
    ml: 'Malayalam',
    mr: 'Marathi',
    or: 'Odia',
    pa: 'Punjabi in Gurmukhi script',
    pt: 'Portuguese',
    sa: 'Sanskrit in Devanagari script',
    te: 'Telugu',
    ur: 'Urdu',
    zh: 'Chinese',
};
const LIBRE_LOCALE_ALIASES = {
    ar: ['ar'],
    de: ['de'],
    es: ['es'],
    fr: ['fr'],
    hi: ['hi'],
    ja: ['ja'],
    pt: ['pt'],
    zh: ['zh', 'zh-Hans', 'zt'],
};

const parseArgs = (argv) => {
    const args = {};
    argv.forEach((arg) => {
        if (!arg.startsWith('--')) return;
        const [rawKey, ...rawValueParts] = arg.slice(2).split('=');
        const value = rawValueParts.length > 0 ? rawValueParts.join('=') : true;
        args[rawKey] = value;
    });
    return args;
};

const args = parseArgs(process.argv.slice(2));
const printUsage = () => {
    console.log([
        'Usage:',
        '  npm run i18n:translate:repair -- --provider=ollama --locale=es --limit=25 --output=artifacts/i18n/es-candidates.jsonl',
        '  npm run i18n:translate:repair -- --provider=libretranslate --locale=fr --limit=25 --output=artifacts/i18n/fr-candidates.jsonl',
        '  npm run i18n:translate:repair -- --provider=file --input=artifacts/i18n/candidates.jsonl --output=artifacts/i18n/validated.jsonl [--apply]',
        '',
        'Providers:',
        '  file            Validate JSON/JSONL candidate translations from NLLB, IndicTrans2, Argos, or other offline tools.',
        '  libretranslate  Calls a configured LibreTranslate server. Requires LIBRETRANSLATE_BASE_URL.',
        '  ollama          Calls a local Ollama model. Uses OLLAMA_BASE_URL and OLLAMA_TRANSLATION_MODEL when set.',
        '',
        'Safety gates:',
        '  ICU syntax and placeholder structure must match the English source.',
        '  Exact English fallback, mojibake, unsafe HTML, weak machine artifacts, brand corruption, and placeholder spacing issues are rejected.',
        '  Native-script locales must contain expected script letters unless the message has no letters to translate.',
        '',
        'Final certification:',
        '  Run npm run i18n:language-quality:final to fail while any locale still has actionable repair or native-signoff debt.',
    ].join('\n'));
};

if (args.help || args.h) {
    printUsage();
    process.exit(0);
}

const providerName = String(args.provider || 'file').toLowerCase();
const applyChanges = Boolean(args.apply);
const limit = Number(args.limit || 25);
const outputPath = path.resolve(repoDir, String(args.output || DEFAULT_OUTPUT));
const inputPath = args.input ? path.resolve(repoDir, String(args.input)) : '';
const localeFilter = args.locale
    ? new Set(String(args.locale).split(',').map((locale) => locale.trim()).filter(Boolean))
    : null;
const riskFilter = args.risk
    ? new Set(String(args.risk).split(',').map((risk) => risk.trim()).filter(Boolean))
    : null;

const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(repoDir, relativePath), 'utf8'));
const writeJson = (filePath, value) => {
    fs.writeFileSync(
        filePath,
        `${JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))), null, 2)}\n`,
        'utf8'
    );
};
const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});
const ensureArray = (value) => (Array.isArray(value) ? value : []);
const stripQualityNoise = (value = '') => String(value)
    .replace(/\{\{\s*[^}]+\s*\}\}|__AURA_PLACEHOLDER_\d+__/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const normalizeForFallbackCheck = (value = '') => stripQualityNoise(value).toLocaleLowerCase('en-US');
const getEnglishTokens = (value = '') => [
    ...new Set(String(value)
        .replace(PLACEHOLDER_TOKEN_PATTERN, ' ')
        .toLocaleLowerCase('en-US')
        .match(/[a-z][a-z-]{3,}/g) || []),
].filter((token) => !ENGLISH_LEAKAGE_ALLOWLIST.has(token));

const getPlaceholderSpacingIssues = (sourceMessage = '', translatedMessage = '') => {
    const issues = [];
    const sourceTokens = [...sourceMessage.matchAll(PLACEHOLDER_TOKEN_PATTERN)].map((match) => match[0]);

    sourceTokens.forEach((token) => {
        const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const sourceHasLeadingSpace = new RegExp(`\\s${escapedToken}`).test(sourceMessage);
        const sourceHasTrailingSpace = new RegExp(`${escapedToken}\\s`).test(sourceMessage);
        const translatedHasLeadingSpace = new RegExp(`\\s${escapedToken}`).test(translatedMessage);
        const translatedHasTrailingSpace = new RegExp(`${escapedToken}\\s`).test(translatedMessage);
        const translatedHasLetterBefore = new RegExp(`\\p{Letter}${escapedToken}`, 'u').test(translatedMessage);
        const translatedHasLetterAfter = new RegExp(`${escapedToken}\\p{Letter}`, 'u').test(translatedMessage);

        if (sourceHasLeadingSpace && translatedHasLetterBefore && !translatedHasLeadingSpace) {
            issues.push(`Missing spacing before placeholder ${token}.`);
        }
        if (sourceHasTrailingSpace && translatedHasLetterAfter && !translatedHasTrailingSpace) {
            issues.push(`Missing spacing after placeholder ${token}.`);
        }
    });

    return issues;
};

const repairPlaceholderSpacing = (sourceMessage = '', translatedMessage = '') => {
    let repairedMessage = String(translatedMessage || '').trim();
    const sourceTokens = [...sourceMessage.matchAll(PLACEHOLDER_TOKEN_PATTERN)].map((match) => match[0]);

    sourceTokens.forEach((token) => {
        const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const sourceHasLeadingSpace = new RegExp(`\\s${escapedToken}`).test(sourceMessage);
        const sourceHasTrailingSpace = new RegExp(`${escapedToken}\\s`).test(sourceMessage);

        if (sourceHasLeadingSpace) {
            repairedMessage = repairedMessage.replace(
                new RegExp(`(\\p{Letter}|\\p{Number})${escapedToken}`, 'gu'),
                `$1 ${token}`
            );
        }

        if (sourceHasTrailingSpace) {
            repairedMessage = repairedMessage.replace(
                new RegExp(`${escapedToken}(?=\\p{Letter}|\\p{Number})`, 'gu'),
                `${token} `
            );
        }
    });

    return repairedMessage;
};

const requiredLocales = readJson('app/src/i18n/quality/requiredLocales.json');
const sourceMessages = readJson('app/src/i18n/messages/reviewed/en.json');
const humanReviewQueue = readJson('app/src/i18n/quality/humanReviewQueue.json');
const qaRules = readJson('app/src/i18n/quality/qaRules.json');
const brandTerms = readJson('app/src/i18n/glossary/brand-terms.json');
const forbiddenTransliterations = readJson('app/src/i18n/glossary/forbidden-transliterations.json');
const supportedLocales = new Set(requiredLocales.filter((locale) => locale !== 'en' && locale !== 'en-XA'));
const englishLeakageAllowlist = new Set(qaRules.englishLeakageAllowlist || []);

const flattenQueue = () => {
    const requests = [];
    ensureArray(humanReviewQueue).forEach((entry) => {
        ensureArray(entry.targets).forEach((target) => {
            if (!supportedLocales.has(target.locale)) return;
            if (localeFilter && !localeFilter.has(target.locale)) return;
            const risk = target.risk || entry.risk || 'low';
            if (riskFilter && !riskFilter.has(risk)) return;
            const ids = ensureArray(target.ids).filter((id) => sourceMessages[id]);
            if (ids.length === 0) return;
            requests.push({
                ids,
                locale: target.locale,
                reason: entry.reason,
                risk,
                sourceMessage: entry.sourceMessage || sourceMessages[ids[0]],
                targetMessage: target.message || '',
            });
        });
    });

    return requests.sort((left, right) => (
        (RISK_ORDER[left.risk] ?? 99) - (RISK_ORDER[right.risk] ?? 99)
        || left.locale.localeCompare(right.locale)
        || left.sourceMessage.localeCompare(right.sourceMessage)
    ));
};

const retry = async (operation, label, attempts = 3) => {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (attempt < attempts) {
                await sleep(250 * attempt);
            }
        }
    }
    throw new Error(`${label} failed after ${attempts} attempt(s): ${lastError?.message || String(lastError)}`);
};

const createLibreTranslateProvider = async () => {
    const baseUrl = String(process.env.LIBRETRANSLATE_BASE_URL || '').replace(/\/+$/, '');
    if (!baseUrl) {
        throw new Error('LIBRETRANSLATE_BASE_URL is required for --provider=libretranslate.');
    }

    const languages = await retry(async () => {
        const response = await fetch(`${baseUrl}/languages`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }, 'LibreTranslate /languages');
    const supportedCodes = new Set(ensureArray(languages).map((language) => language.code));
    const apiKey = process.env.LIBRETRANSLATE_API_KEY || '';

    return {
        name: 'libretranslate',
        async translateText(text, locale) {
            const target = (LIBRE_LOCALE_ALIASES[locale] || [locale]).find((code) => supportedCodes.has(code));
            if (!target) {
                throw new Error(`LibreTranslate does not advertise support for locale ${locale}.`);
            }

            return retry(async () => {
                const response = await fetch(`${baseUrl}/translate`, {
                    body: JSON.stringify({
                        api_key: apiKey || undefined,
                        format: 'text',
                        q: text,
                        source: 'en',
                        target,
                    }),
                    headers: { 'content-type': 'application/json' },
                    method: 'POST',
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const payload = await response.json();
                return String(payload.translatedText || '').trim();
            }, `LibreTranslate ${locale}`);
        },
    };
};

const createOllamaProvider = () => {
    const baseUrl = String(process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
    const model = String(process.env.OLLAMA_TRANSLATION_MODEL || 'llama3.2:3b');

    return {
        name: `ollama:${model}`,
        async translateText(text, locale) {
            const targetName = TARGET_NAMES[locale] || locale;
            const prompt = [
                `Translate this ecommerce UI text from English to ${targetName}.`,
                'Return only the translated text.',
                'Preserve product names, brand names, numbers, punctuation, and spacing.',
                'Preserve ICU placeholders such as {count}, {code}, and {category} exactly, with natural spacing around them.',
                'Use polished product UI language, not literal word-for-word machine phrasing.',
                'Keep Git/build technical labels like Commit as "Commit" if a natural local equivalent would sound awkward.',
                'Do not add explanations, markdown, labels, or quotation marks.',
                '',
                text,
            ].join('\n');

            return retry(async () => {
                const response = await fetch(`${baseUrl}/api/generate`, {
                    body: JSON.stringify({
                        model,
                        options: { temperature: 0 },
                        prompt,
                        stream: false,
                    }),
                    headers: { 'content-type': 'application/json' },
                    method: 'POST',
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const payload = await response.json();
                return String(payload.response || '').trim().replace(/^["']|["']$/g, '');
            }, `Ollama ${locale}`);
        },
    };
};

const readCandidateFile = () => {
    if (!inputPath) throw new Error('--input=<path> is required for --provider=file.');
    const raw = fs.readFileSync(inputPath, 'utf8').trim();
    if (!raw) return [];
    if (raw.startsWith('[')) return JSON.parse(raw);
    return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
};

const shouldTranslateLiteral = (value = '') => LETTER_PATTERN.test(value);

const translateAstLiterals = async (ast, locale, provider, cache) => Promise.all(ast.map(async (element) => {
    if (element.type === TYPE.literal) {
        if (!shouldTranslateLiteral(element.value)) return { ...element };
        const cacheKey = `${locale}\u0000${element.value}`;
        const translated = cache.has(cacheKey)
            ? cache.get(cacheKey)
            : await provider.translateText(element.value, locale);
        cache.set(cacheKey, translated || element.value);
        return { ...element, value: translated || element.value };
    }

    if (element.type === TYPE.plural || element.type === TYPE.select) {
        const options = {};
        await Promise.all(Object.entries(element.options).map(async ([key, option]) => {
            options[key] = {
                ...option,
                value: await translateAstLiterals(option.value, locale, provider, cache),
            };
        }));
        return { ...element, options };
    }

    if (element.type === TYPE.tag) {
        return {
            ...element,
            children: await translateAstLiterals(element.children, locale, provider, cache),
        };
    }

    return { ...element };
}));

const translateIcuMessage = async (sourceMessage, locale, provider, cache) => {
    const sourceAst = parse(sourceMessage);
    const translatedAst = await translateAstLiterals(sourceAst, locale, provider, cache);
    return printAST(translatedAst);
};

const messageHasNativeLetters = (message, locale) => {
    const rule = NATIVE_SCRIPT_RULES[locale];
    if (!rule) return true;
    const qualityText = stripQualityNoise(message);
    if (!LETTER_PATTERN.test(qualityText)) return true;
    return [...qualityText].some((letter) => rule.patterns.some((pattern) => pattern.test(letter)));
};

const validateCandidate = ({ ids, locale, translatedMessage }) => {
    const firstId = ids[0];
    const sourceMessage = sourceMessages[firstId];
    const issues = [];

    if (!supportedLocales.has(locale)) issues.push(`Unsupported locale: ${locale}`);
    if (!sourceMessage) issues.push(`Unknown source id: ${firstId}`);
    if (typeof translatedMessage !== 'string' || translatedMessage.trim() === '') issues.push('Empty translated message.');
    if (MOJIBAKE_PATTERN.test(translatedMessage)) issues.push('Translated message contains mojibake.');
    if (RAW_HTML_RISK_PATTERN.test(translatedMessage)) issues.push('Translated message contains unsafe HTML-like content.');

    if (sourceMessage && translatedMessage) {
        try {
            const sourceAst = parse(sourceMessage);
            const translatedAst = parse(translatedMessage);
            const structuralResult = isStructurallySame(sourceAst, translatedAst);
            if (!structuralResult.success) issues.push(`ICU structure mismatch: ${structuralResult.error.message}`);
        } catch (error) {
            issues.push(`Invalid ICU: ${error.message}`);
        }

        const isExactEnglish = normalizeForFallbackCheck(sourceMessage) === normalizeForFallbackCheck(translatedMessage);
        if (
            locale !== 'en'
            && locale !== 'en-XA'
            && isExactEnglish
            && !englishLeakageAllowlist.has(sourceMessage)
        ) {
            issues.push('Candidate is still exact English fallback.');
        }

        if (BAD_MACHINE_TRANSLATION_PATTERN.test(translatedMessage)) {
            issues.push('Candidate contains a known weak machine-translation artifact.');
        }

        if (PROMPT_LEAKAGE_PATTERN.test(translatedMessage)) {
            issues.push('Candidate appears to include prompt/instruction leakage.');
        }

        issues.push(...getPlaceholderSpacingIssues(sourceMessage, translatedMessage));

        const leakedEnglishTokens = getEnglishTokens(sourceMessage)
            .filter((token) => getEnglishTokens(translatedMessage).includes(token));
        if (leakedEnglishTokens.length > 0) {
            issues.push(`Candidate appears to leak English token(s): ${leakedEnglishTokens.slice(0, 5).join(', ')}`);
        }

        Object.entries(brandTerms).forEach(([term, rule]) => {
            if (rule.doNotTranslate && sourceMessage.includes(term) && !translatedMessage.includes(term)) {
                issues.push(`Required brand term missing: ${term}`);
            }
        });

        Object.entries(forbiddenTransliterations).forEach(([term, translations]) => {
            translations.forEach((translation) => {
                if (translatedMessage.includes(translation)) {
                    issues.push(`Forbidden transliteration for ${term}: ${translation}`);
                }
            });
        });

        if (!messageHasNativeLetters(translatedMessage, locale)) {
            issues.push(`No ${NATIVE_SCRIPT_RULES[locale]?.label || locale} letters found in translated text.`);
        }
    }

    return issues;
};

const normalizeCandidate = (candidate) => {
    const ids = Array.isArray(candidate.ids)
        ? candidate.ids.filter(Boolean)
        : [candidate.id].filter(Boolean);
    const sourceMessage = candidate.sourceMessage || sourceMessages[ids[0]] || '';
    const translatedMessage = candidate.translatedMessage || candidate.translation || candidate.message || '';

    return {
        ids,
        locale: candidate.locale,
        provider: candidate.provider || providerName,
        sourceMessage,
        translatedMessage: repairPlaceholderSpacing(sourceMessage, translatedMessage),
    };
};

const buildProviderCandidates = async () => {
    const provider = providerName === 'libretranslate'
        ? await createLibreTranslateProvider()
        : providerName === 'ollama'
            ? createOllamaProvider()
            : null;

    if (!provider) {
        throw new Error(`Unsupported provider for direct translation: ${providerName}`);
    }

    const requests = flattenQueue().slice(0, limit);
    const cache = new Map();
    const candidates = [];

    for (const request of requests) {
        try {
            const translatedMessage = await translateIcuMessage(request.sourceMessage, request.locale, provider, cache);
            candidates.push({
                ids: request.ids,
                locale: request.locale,
                provider: provider.name,
                reason: request.reason,
                risk: request.risk,
                sourceMessage: request.sourceMessage,
                translatedMessage,
            });
            console.log(`Translated ${request.locale} ${request.ids.length} id(s): ${request.sourceMessage.slice(0, 72)}`);
        } catch (error) {
            candidates.push({
                error: error.message,
                ids: request.ids,
                locale: request.locale,
                provider: provider.name,
                reason: request.reason,
                risk: request.risk,
                sourceMessage: request.sourceMessage,
                translatedMessage: '',
            });
            console.warn(`Skipped ${request.locale}: ${error.message}`);
        }
    }

    return candidates;
};

const rawCandidates = providerName === 'file'
    ? readCandidateFile()
    : await buildProviderCandidates();
const candidates = rawCandidates.map(normalizeCandidate);
const results = candidates.map((candidate) => ({
    ...candidate,
    issues: validateCandidate(candidate),
}));
const validResults = results.filter((result) => result.issues.length === 0);
const invalidResults = results.filter((result) => result.issues.length > 0);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
    outputPath,
    `${results.map((result) => JSON.stringify({
        ids: result.ids,
        issues: result.issues,
        locale: result.locale,
        provider: result.provider,
        sourceMessage: result.sourceMessage,
        translatedMessage: result.translatedMessage,
        valid: result.issues.length === 0,
    })).join('\n')}\n`,
    'utf8'
);

if (applyChanges) {
    const catalogs = new Map();
    validResults.forEach((result) => {
        const catalogPath = path.join(reviewedDir, `${result.locale}.json`);
        const catalog = catalogs.get(result.locale)
            || JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
        result.ids.forEach((id) => {
            catalog[id] = result.translatedMessage;
        });
        catalogs.set(result.locale, catalog);
    });

    catalogs.forEach((catalog, locale) => {
        writeJson(path.join(reviewedDir, `${locale}.json`), catalog);
    });
}

console.log('Free translation repair');
console.log(`Provider: ${providerName}`);
console.log(`Candidates processed: ${results.length}`);
console.log(`Valid candidates: ${validResults.length}`);
console.log(`Rejected candidates: ${invalidResults.length}`);
console.log(`Output: ${path.relative(repoDir, outputPath).replace(/\\/g, '/')}`);
console.log(`Catalog writes: ${applyChanges ? 'applied' : 'dry-run only'}`);

if (invalidResults.length > 0) {
    console.log('Rejected examples:');
    invalidResults.slice(0, 8).forEach((result) => {
        console.log(`- ${result.locale} ${result.ids.join(', ')}: ${result.issues.join('; ')}`);
    });
}
