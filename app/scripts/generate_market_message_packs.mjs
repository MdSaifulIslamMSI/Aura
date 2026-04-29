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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_ROOT = path.resolve(__dirname, '..', 'src', 'config');
const PACK_ROOT = path.join(CONFIG_ROOT, 'marketMessagePacks');
const SUPPORTED_LANGUAGE_CODES = ['en', 'hi', 'es', 'fr', 'de', 'ar', 'ja', 'pt', 'zh'];
const SOURCE_LANGUAGE = 'en';
const LANGUAGE_ARG_PREFIX = '--languages=';
const PLACEHOLDER_PATTERN = /\{\{\s*([^}\s]+)\s*\}\}/g;
const MAX_TRANSLATION_ATTEMPTS = 4;
const TRANSLATION_CONCURRENCY = 4;
const NATIVE_SCRIPT_REFRESH_LANGUAGE_CODES = new Set(['hi', 'ar', 'ja', 'zh']);
const LETTER_PATTERN = /\p{Letter}/gu;
const SHORT_TOKEN_PATTERN = /^[A-Z0-9&/+.:-]{1,8}$/;

const NATIVE_SCRIPT_RULES = {
    hi: {
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

const parseTranslationPayload = async (response) => {
    const payload = await response.json();
    const segments = Array.isArray(payload?.[0]) ? payload[0] : [];
    return segments
        .map((segment) => (Array.isArray(segment) ? String(segment[0] || '') : ''))
        .join('')
        .trim();
};

const wait = (durationMs) => new Promise((resolve) => {
    setTimeout(resolve, durationMs);
});

const isNativeTranslationUsable = (sourceText, translatedText, languageCode) => {
    const nativeRule = NATIVE_SCRIPT_RULES[languageCode];
    if (!nativeRule) return true;

    const sourceLetters = countLetters(stripPlaceholders(sourceText));
    if (sourceLetters === 0) return true;

    const translatedWithoutPlaceholders = stripPlaceholders(translatedText).trim();
    const nativeLetters = countNativeLetters(translatedWithoutPlaceholders, nativeRule.patterns);
    if (nativeLetters > 0) return true;

    const compactSource = stripPlaceholders(sourceText).replace(/\s+/g, '');
    return SHORT_TOKEN_PATTERN.test(compactSource);
};

const translateSingleText = async (text, targetLanguage) => {
    if (!text || targetLanguage === SOURCE_LANGUAGE) {
        return text;
    }

    const { protectedText, placeholders } = protectPlaceholders(text);

    for (let attempt = 1; attempt <= MAX_TRANSLATION_ATTEMPTS; attempt += 1) {
        const query = new URLSearchParams({
            client: 'gtx',
            sl: SOURCE_LANGUAGE,
            tl: targetLanguage,
            dt: 't',
            q: protectedText,
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(`https://translate.googleapis.com/translate_a/single?${query.toString()}`, {
                headers: {
                    Accept: 'application/json',
                    'User-Agent': 'AuraCommerce/1.0',
                },
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(`Translation upstream returned ${response.status}`);
            }

            const translated = restorePlaceholders(await parseTranslationPayload(response), placeholders) || text;
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
        return sortObjectEntries(GENERATED_BASE_MARKET_MESSAGES.en || {});
    }

    return sortObjectEntries({
        ...(GENERATED_BASE_MARKET_MESSAGES[languageCode] || {}),
        ...(PRIORITY_MARKET_MESSAGES[languageCode] || {}),
        ...(GENERATED_LOCALE_MESSAGES[languageCode] || {}),
        ...(GENERATED_DYNAMIC_MARKET_MESSAGES[languageCode] || {}),
        ...(REMAINING_UI_LOCALE_MESSAGES[languageCode] || {}),
        ...(LOCALE_POLISH_MESSAGES[languageCode] || {}),
    });
};

const refreshNativeScriptPack = async (languageCode, baseMessages, englishMessages) => {
    if (!NATIVE_SCRIPT_REFRESH_LANGUAGE_CODES.has(languageCode)) {
        return baseMessages;
    }

    const sourceEntries = Object.entries(englishMessages)
        .filter(([, value]) => typeof value === 'string' && value.trim().length > 0);
    const uniqueTexts = [...new Set(sourceEntries.map(([, value]) => value))];
    const translations = new Map();
    let completedCount = 0;

    console.log(`${languageCode}: refreshing ${uniqueTexts.length} English source strings with native-script validation`);

    await mapWithConcurrency(uniqueTexts, TRANSLATION_CONCURRENCY, async (text) => {
        const translatedText = await translateSingleText(text, languageCode);
        translations.set(text, translatedText);
        completedCount += 1;

        if (completedCount % 50 === 0 || completedCount === uniqueTexts.length) {
            console.log(`${languageCode}: translated ${completedCount}/${uniqueTexts.length}`);
        }
    });

    return sortObjectEntries({
        ...baseMessages,
        ...Object.fromEntries(sourceEntries.map(([key, value]) => [
            key,
            translations.get(value) || value,
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
    const englishMessages = sortObjectEntries(MARKET_CONFIG_MESSAGES.en || buildBaseLanguagePack(SOURCE_LANGUAGE));

    for (const languageCode of SUPPORTED_LANGUAGE_CODES.filter((code) => requestedLanguages.includes(code))) {
        const baseMessages = languageCode === SOURCE_LANGUAGE
            ? englishMessages
            : buildBaseLanguagePack(languageCode);
        const messages = await refreshNativeScriptPack(languageCode, baseMessages, englishMessages);
        writeLanguagePack(languageCode, messages);
        console.log(`${languageCode}: ${Object.keys(messages).length} messages`);
    }

    console.log(`Wrote locale packs to ${PACK_ROOT}`);
};

main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
});
