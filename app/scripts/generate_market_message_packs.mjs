import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATED_MARKET_MESSAGES as GENERATED_BASE_MARKET_MESSAGES } from '../src/config/generatedMarketMessages.js';
import { PRIORITY_MARKET_MESSAGES } from '../src/config/priorityMarketMessages.js';
import { GENERATED_MARKET_MESSAGES as GENERATED_LOCALE_MESSAGES } from '../src/config/generatedLocaleMessages.js';
import { GENERATED_DYNAMIC_MARKET_MESSAGES } from '../src/config/generatedDynamicLocaleMessages.js';
import { REMAINING_UI_LOCALE_MESSAGES } from '../src/config/remainingUiLocaleMessages.js';
import { LOCALE_POLISH_MESSAGES } from '../src/config/localePolishMessages.js';
import { MARKET_MESSAGES as MARKET_CONFIG_MESSAGES } from '../src/config/marketConfig.js';
import { MARKET_MESSAGE_PACK as ES_REFERENCE_MARKET_MESSAGES } from '../src/config/marketMessagePacks/es.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_ROOT = path.resolve(__dirname, '..', 'src');
const CONFIG_ROOT = path.resolve(__dirname, '..', 'src', 'config');
const PACK_ROOT = path.join(CONFIG_ROOT, 'marketMessagePacks');
const REVIEWED_CATALOG_ROOT = path.resolve(__dirname, '..', 'src', 'i18n', 'messages', 'reviewed');
const SUPPORTED_LANGUAGE_CODES = ['en', 'bn', 'hi', 'te', 'mr', 'ur', 'gu', 'pa', 'ml', 'kn', 'or', 'as', 'sa', 'es', 'fr', 'de', 'ar', 'ja', 'pt', 'zh'];
const SOURCE_LANGUAGE = 'en';
const LANGUAGE_ARG_PREFIX = '--languages=';
const SKIP_NATIVE_REFRESH_ARG = '--skip-native-refresh';
const PLACEHOLDER_PATTERN = /\{\{\s*([^}\s]+)\s*\}\}/g;
const ICU_ARGUMENT_PATTERN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const TRANSLATION_CALL_PATTERN = /\bt\(\s*(['"])([^'"`\r\n]+)\1/g;
const SOURCE_FILE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const SKIPPED_SOURCE_DIRECTORIES = new Set(['node_modules', 'dist', 'build']);
const IGNORE_SOURCE_FILE_PATTERN = /\.(test|spec)\.[jt]sx?$/i;
const MAX_TRANSLATION_ATTEMPTS = 4;
const TRANSLATION_CONCURRENCY = 4;
const NATIVE_SCRIPT_REFRESH_LANGUAGE_CODES = new Set(['bn', 'hi', 'te', 'mr', 'ur', 'gu', 'pa', 'ml', 'kn', 'or', 'as', 'sa', 'ar', 'ja', 'zh']);
const COMPLETE_SOURCE_REFRESH_LANGUAGE_CODES = new Set(['bn', 'te', 'mr', 'ur', 'gu', 'pa', 'ml', 'kn', 'or', 'as', 'sa']);
const LETTER_PATTERN = /\p{Letter}/gu;
const SHORT_TOKEN_PATTERN = /^[A-Z0-9&/+.:-]{1,8}$/;
const NATIVE_SCRIPT_EXEMPT_TOKEN_PATTERN = /^n\/a$/i;
const NATIVE_SCRIPT_EXEMPT_VALUE_PATTERN = /^(?:https?:\/\/|www\.|mailto:|tel:|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i;
const SHORT_UI_TOKEN_PATTERN = /^[A-Za-z0-9&/+.:-]{1,16}$/;
const TECHNICAL_TOKEN_PATTERN = /^[A-Z0-9][A-Z0-9&/+.:-]{1,40}$/;
const PLACEHOLDER_HEAVY_LABEL_PATTERN = /^[A-Za-z0-9&/+.:\-| ]{1,32}$/;
const LEGACY_DYNAMIC_SOURCE_KEYS = [
    'checkout.addressType.home',
    'checkout.addressType.other',
    'checkout.addressType.work',
    'checkout.payment.cardDescription',
    'checkout.payment.cardTitle',
    'checkout.payment.codDescription',
    'checkout.payment.codTitle',
    'checkout.payment.netbankingDescription',
    'checkout.payment.netbankingTitle',
    'checkout.payment.rail.cardEmpty',
    'checkout.payment.rail.cardTitle',
    'checkout.payment.rail.netbankingEmpty',
    'checkout.payment.rail.netbankingTitle',
    'checkout.payment.rail.upiEmpty',
    'checkout.payment.rail.upiTitle',
    'checkout.payment.rail.walletEmpty',
    'checkout.payment.rail.walletTitle',
    'checkout.payment.upiDescription',
    'checkout.payment.upiTitle',
    'checkout.payment.walletDescription',
    'checkout.payment.walletTitle',
    'status.degradedMessage',
    'status.degradedTitle',
    'status.unavailableMessage',
    'status.unavailableTitle',
    'status.warmingMessage',
    'status.warmingTitle',
];

const NATIVE_SCRIPT_RULES = {
    bn: {
        label: 'Bengali',
        patterns: [/\p{Script=Bengali}/gu],
    },
    hi: {
        label: 'Devanagari',
        patterns: [/\p{Script=Devanagari}/gu],
    },
    te: {
        label: 'Telugu',
        patterns: [/\p{Script=Telugu}/gu],
    },
    mr: {
        label: 'Devanagari',
        patterns: [/\p{Script=Devanagari}/gu],
    },
    ur: {
        label: 'Arabic',
        patterns: [/\p{Script=Arabic}/gu],
    },
    gu: {
        label: 'Gujarati',
        patterns: [/\p{Script=Gujarati}/gu],
    },
    pa: {
        label: 'Gurmukhi',
        patterns: [/\p{Script=Gurmukhi}/gu],
    },
    ml: {
        label: 'Malayalam',
        patterns: [/\p{Script=Malayalam}/gu],
    },
    kn: {
        label: 'Kannada',
        patterns: [/\p{Script=Kannada}/gu],
    },
    or: {
        label: 'Odia',
        patterns: [/\p{Script=Oriya}/gu],
    },
    as: {
        label: 'Bengali',
        patterns: [/\p{Script=Bengali}/gu],
    },
    sa: {
        label: 'Devanagari',
        patterns: [/\p{Script=Devanagari}/gu],
    },
    ar: {
        label: 'Arabic',
        patterns: [/\p{Script=Arabic}/gu],
    },
    ja: {
        label: 'Japanese',
        patterns: [
            /\p{Script=Hiragana}/gu,
            /\p{Script=Katakana}/gu,
            /\p{Script=Han}/gu,
        ],
    },
    zh: {
        label: 'Han',
        patterns: [/\p{Script=Han}/gu],
    },
};

const sortObjectEntries = (value = {}) => Object.fromEntries(
    Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right))
);

const walkSourceFiles = (directoryPath, files = []) => {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
        const resolvedPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            if (!SKIPPED_SOURCE_DIRECTORIES.has(entry.name)) {
                walkSourceFiles(resolvedPath, files);
            }
            continue;
        }

        if (!SOURCE_FILE_EXTENSIONS.has(path.extname(entry.name))) continue;
        if (IGNORE_SOURCE_FILE_PATTERN.test(entry.name)) continue;
        files.push(resolvedPath);
    }

    return files;
};

let legacyCompatibilityKeys;

const getLegacyCompatibilityKeys = () => {
    if (legacyCompatibilityKeys) return legacyCompatibilityKeys;

    const keys = new Set([
        ...LEGACY_DYNAMIC_SOURCE_KEYS,
        ...Object.keys(MARKET_CONFIG_MESSAGES.en || {}),
    ]);

    walkSourceFiles(SRC_ROOT).forEach((filePath) => {
        const source = fs.readFileSync(filePath, 'utf8');
        let match = TRANSLATION_CALL_PATTERN.exec(source);
        while (match) {
            const key = String(match[2] || '').trim();
            if (key && !key.includes('${')) {
                keys.add(key);
            }
            match = TRANSLATION_CALL_PATTERN.exec(source);
        }
        TRANSLATION_CALL_PATTERN.lastIndex = 0;
    });

    legacyCompatibilityKeys = keys;
    return legacyCompatibilityKeys;
};

const parseGeneratedPackContents = (source = '') => {
    const match = String(source).match(/export const MARKET_MESSAGE_PACK = (\{[\s\S]*?\});\s*export default MARKET_MESSAGE_PACK;/);
    if (!match?.[1]) return {};
    return JSON.parse(match[1]);
};

const readExistingLanguagePack = (languageCode) => {
    const packPath = path.join(PACK_ROOT, `${languageCode}.js`);
    if (!fs.existsSync(packPath)) return {};

    try {
        return parseGeneratedPackContents(fs.readFileSync(packPath, 'utf8'));
    } catch (error) {
        console.warn(`${languageCode}: ignoring existing locale pack that could not be parsed: ${error?.message || String(error)}`);
        return {};
    }
};

const readReviewedCatalog = (languageCode) => {
    const catalogPath = path.join(REVIEWED_CATALOG_ROOT, `${languageCode}.json`);
    if (!fs.existsSync(catalogPath)) return {};

    try {
        return JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    } catch (error) {
        console.warn(`${languageCode}: ignoring reviewed ICU catalog that could not be parsed: ${error?.message || String(error)}`);
        return {};
    }
};

const convertIcuMessageToLegacyTemplate = (message = '') => (
    String(message).replace(ICU_ARGUMENT_PATTERN, '{{$1}}')
);

const buildReviewedCompatibilityMessages = (languageCode) => {
    const compatibilityKeys = getLegacyCompatibilityKeys();
    const toLegacyEntries = (messages = {}) => Object.entries(messages)
        .filter(([key]) => compatibilityKeys.has(key))
        .map(([key, message]) => [
            key,
            convertIcuMessageToLegacyTemplate(message),
        ]);

    return sortObjectEntries({
        ...Object.fromEntries(toLegacyEntries(readReviewedCatalog(SOURCE_LANGUAGE))),
        ...Object.fromEntries(toLegacyEntries(readReviewedCatalog(languageCode))),
    });
};

const applyReviewedCatalogFallback = (messages = {}, languageCode = SOURCE_LANGUAGE) => {
    const reviewedMessages = buildReviewedCompatibilityMessages(languageCode);
    const nextMessages = { ...(messages || {}) };

    Object.entries(reviewedMessages).forEach(([key, message]) => {
        if (typeof nextMessages[key] !== 'string' || nextMessages[key].length === 0) {
            nextMessages[key] = message;
        }
    });

    return sortObjectEntries(nextMessages);
};

const parseRequestedLanguageCodes = () => {
    const languagesArg = process.argv.find((arg) => arg.startsWith(LANGUAGE_ARG_PREFIX));
    if (!languagesArg) return SUPPORTED_LANGUAGE_CODES;

    const requestedLanguages = languagesArg
        .slice(LANGUAGE_ARG_PREFIX.length)
        .split(',')
        .map((languageCode) => languageCode.trim().toLowerCase())
        .filter(Boolean);
    const unsupportedLanguages = requestedLanguages.filter((languageCode) => (
        !SUPPORTED_LANGUAGE_CODES.includes(languageCode)
    ));

    if (unsupportedLanguages.length > 0) {
        throw new Error(`Unsupported locale pack language(s): ${unsupportedLanguages.join(', ')}`);
    }

    return [...new Set(requestedLanguages)];
};

const countMatches = (value, pattern) => (String(value).match(pattern) || []).length;

const countLetters = (value) => countMatches(value, LETTER_PATTERN);

const countNativeLetters = (value, patterns) => {
    const letters = String(value).match(LETTER_PATTERN) || [];
    return letters.filter((letter) => patterns.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(letter);
    })).length;
};

const stripPlaceholders = (value = '') => String(value)
    .replace(PLACEHOLDER_PATTERN, ' ')
    .replace(/__AURA_PLACEHOLDER_\d+__/g, ' ');

const protectPlaceholders = (text) => {
    const placeholders = [];
    const protectedText = String(text || '').replace(PLACEHOLDER_PATTERN, (match) => {
        const token = `__AURA_PLACEHOLDER_${placeholders.length}__`;
        placeholders.push({ token, match });
        return token;
    });

    return { protectedText, placeholders };
};

const restorePlaceholders = (text, placeholders) => placeholders.reduce(
    (result, placeholder) => result.split(placeholder.token).join(placeholder.match),
    String(text || ''),
);

const wait = (durationMs) => new Promise((resolve) => {
    setTimeout(resolve, durationMs);
});

const isNativeTranslationUsable = (sourceText, translatedText, languageCode) => {
    const nativeRule = NATIVE_SCRIPT_RULES[languageCode];
    if (!nativeRule) return true;

    const sourceLetters = countLetters(stripPlaceholders(sourceText));
    if (sourceLetters === 0) return true;

    const strippedSource = stripPlaceholders(sourceText).trim();
    if (NATIVE_SCRIPT_EXEMPT_VALUE_PATTERN.test(strippedSource)) return true;

    const translatedWithoutPlaceholders = stripPlaceholders(translatedText).trim();
    const nativeLetters = countNativeLetters(translatedWithoutPlaceholders, nativeRule.patterns);
    if (nativeLetters > 0) return true;

    const compactSource = stripPlaceholders(sourceText).replace(/\s+/g, '');
    const normalizedSource = stripPlaceholders(sourceText).replace(/\s+/g, ' ').trim();
    PLACEHOLDER_PATTERN.lastIndex = 0;
    const hasPlaceholders = PLACEHOLDER_PATTERN.test(sourceText);
    PLACEHOLDER_PATTERN.lastIndex = 0;
    return SHORT_TOKEN_PATTERN.test(compactSource)
        || SHORT_UI_TOKEN_PATTERN.test(compactSource)
        || TECHNICAL_TOKEN_PATTERN.test(compactSource)
        || (hasPlaceholders && PLACEHOLDER_HEAVY_LABEL_PATTERN.test(normalizedSource))
        || NATIVE_SCRIPT_EXEMPT_TOKEN_PATTERN.test(compactSource);
};

const translateSingleText = async (text, targetLanguage, sourceLanguage = SOURCE_LANGUAGE) => {
    if (!text || targetLanguage === SOURCE_LANGUAGE) {
        return text;
    }

    const { protectedText, placeholders } = protectPlaceholders(text);

    for (let attempt = 1; attempt <= MAX_TRANSLATION_ATTEMPTS; attempt += 1) {
        const libreTranslateBaseUrl = String(process.env.LIBRETRANSLATE_BASE_URL || '').replace(/\/+$/, '');
        if (!libreTranslateBaseUrl) {
            throw new Error('LIBRETRANSLATE_BASE_URL is required to generate translated locale packs.');
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(`${libreTranslateBaseUrl}/translate`, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    format: 'text',
                    q: protectedText,
                    source: sourceLanguage,
                    target: targetLanguage,
                }),
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(`Translation upstream returned ${response.status}`);
            }

            const payload = await response.json();
            const translated = restorePlaceholders(String(payload?.translatedText || ''), placeholders) || text;
            if (!isNativeTranslationUsable(text, translated, targetLanguage)) {
                throw new Error(`Native script validation failed for ${targetLanguage}: ${JSON.stringify(text)} -> ${JSON.stringify(translated)}`);
            }

            return translated;
        } catch (error) {
            if (attempt >= MAX_TRANSLATION_ATTEMPTS) {
                throw error;
            }
            await wait(400 * attempt);
        } finally {
            clearTimeout(timeoutId);
        }
    }

    return text;
};

const mapWithConcurrency = async (items, limit, worker) => {
    const results = new Array(items.length);
    let index = 0;

    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (index < items.length) {
            const currentIndex = index;
            index += 1;
            results[currentIndex] = await worker(items[currentIndex], currentIndex);
        }
    });

    await Promise.all(runners);
    return results;
};

const buildBaseLanguagePack = (languageCode) => {
    if (languageCode === 'en') {
        return sortObjectEntries({
            ...readExistingLanguagePack(languageCode),
            ...(GENERATED_BASE_MARKET_MESSAGES.en || {}),
        });
    }

    return sortObjectEntries({
        ...readExistingLanguagePack(languageCode),
        ...(GENERATED_BASE_MARKET_MESSAGES[languageCode] || {}),
        ...(PRIORITY_MARKET_MESSAGES[languageCode] || {}),
        ...(GENERATED_LOCALE_MESSAGES[languageCode] || {}),
        ...(GENERATED_DYNAMIC_MARKET_MESSAGES[languageCode] || {}),
        ...(REMAINING_UI_LOCALE_MESSAGES[languageCode] || {}),
        ...(LOCALE_POLISH_MESSAGES[languageCode] || {}),
    });
};

const buildTranslationSources = (messages = {}, sourceLanguage = SOURCE_LANGUAGE) => Object.fromEntries(
    Object.entries(messages || {}).map(([key, text]) => [
        key,
        { text, sourceLanguage },
    ]),
);

const buildCompleteSourceMessages = (languageCode, englishMessages) => sortObjectEntries({
    // Older locale layers do not expose every canonical English string. Use the
    // complete Spanish pack only as a final semantic source for those legacy keys.
    ...buildTranslationSources(ES_REFERENCE_MARKET_MESSAGES, 'es'),
    ...buildTranslationSources(REMAINING_UI_LOCALE_MESSAGES.en || {}),
    ...buildTranslationSources(MARKET_CONFIG_MESSAGES[languageCode] || {}),
    ...buildTranslationSources(englishMessages),
});

const refreshNativeScriptPack = async (languageCode, baseMessages, englishMessages) => {
    if (!NATIVE_SCRIPT_REFRESH_LANGUAGE_CODES.has(languageCode)) {
        return baseMessages;
    }

    const sourceMessages = COMPLETE_SOURCE_REFRESH_LANGUAGE_CODES.has(languageCode)
        ? buildCompleteSourceMessages(languageCode, englishMessages)
        : buildTranslationSources(englishMessages);
    const sourceEntries = Object.entries(sourceMessages)
        .filter(([, source]) => typeof source?.text === 'string' && source.text.trim().length > 0);
    const getSourceKey = ({ sourceLanguage, text }) => `${sourceLanguage}\u0000${text}`;
    const uniqueSources = [...new Map(sourceEntries.map(([, source]) => [getSourceKey(source), source])).values()];
    const translations = new Map();
    let completedCount = 0;

    console.log(`${languageCode}: refreshing ${uniqueSources.length} source strings with native-script validation`);

    await mapWithConcurrency(uniqueSources, TRANSLATION_CONCURRENCY, async (source) => {
        const translatedText = await translateSingleText(
            source.text,
            languageCode,
            source.sourceLanguage,
        );
        translations.set(getSourceKey(source), translatedText);
        completedCount += 1;

        if (completedCount % 50 === 0 || completedCount === uniqueSources.length) {
            console.log(`${languageCode}: translated ${completedCount}/${uniqueSources.length}`);
        }
    });

    return sortObjectEntries({
        ...baseMessages,
        ...Object.fromEntries(sourceEntries.map(([key, source]) => [
            key,
            translations.get(getSourceKey(source)) || source.text,
        ])),
    });
};

const writeLanguagePack = (languageCode, messages) => {
    const targetPath = path.join(PACK_ROOT, `${languageCode}.js`);
    const fileContents = `// Generated by scripts/generate_market_message_packs.mjs. Do not edit by hand.\nexport const MARKET_MESSAGE_PACK = ${JSON.stringify(messages, null, 2)};\nexport default MARKET_MESSAGE_PACK;\n`;
    fs.writeFileSync(targetPath, fileContents, 'utf8');
};

const main = async () => {
    fs.mkdirSync(PACK_ROOT, { recursive: true });
    const requestedLanguages = parseRequestedLanguageCodes();
    const shouldRefreshNativeScript = !process.argv.includes(SKIP_NATIVE_REFRESH_ARG)
        && process.env.SKIP_NATIVE_REFRESH !== '1';
    const englishMessages = sortObjectEntries(MARKET_CONFIG_MESSAGES.en || buildBaseLanguagePack(SOURCE_LANGUAGE));
    const translationSourceMessages = sortObjectEntries({
        ...englishMessages,
        ...buildReviewedCompatibilityMessages(SOURCE_LANGUAGE),
    });

    for (const languageCode of SUPPORTED_LANGUAGE_CODES.filter((code) => requestedLanguages.includes(code))) {
        if (languageCode === SOURCE_LANGUAGE) {
            const messages = buildBaseLanguagePack(SOURCE_LANGUAGE);
            writeLanguagePack(languageCode, messages);
            console.log(`${languageCode}: ${Object.keys(messages).length} messages`);
            continue;
        }

        const baseMessages = languageCode === SOURCE_LANGUAGE
            ? englishMessages
            : buildBaseLanguagePack(languageCode);
        const preservedMessages = shouldRefreshNativeScript
            ? baseMessages
            : sortObjectEntries({
                ...baseMessages,
                ...readExistingLanguagePack(languageCode),
            });
        const fallbackMessages = applyReviewedCatalogFallback(preservedMessages, languageCode);
        const messages = shouldRefreshNativeScript
            ? await refreshNativeScriptPack(languageCode, fallbackMessages, translationSourceMessages)
            : fallbackMessages;
        writeLanguagePack(languageCode, messages);
        console.log(`${languageCode}: ${Object.keys(messages).length} messages`);
    }

    console.log(`Wrote locale packs to ${PACK_ROOT}`);
};

main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
});
