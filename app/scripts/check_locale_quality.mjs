import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ensureAllMarketMessagesLoaded,
    MARKET_MESSAGES,
    SUPPORTED_LANGUAGES,
} from '../src/config/marketConfig.js';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const appDir = path.resolve(scriptDir, '..');
const qualityCsvPath = path.resolve(appDir, 'translation-quality.csv');

const SOURCE_LANGUAGE = 'en';
const REPORT_ONLY_FLAG = '--report-only';
const isReportOnly = process.argv.includes(REPORT_ONLY_FLAG);

const MAX_EXACT_ENGLISH_PERCENT = 10;
const MIN_NATIVE_LETTER_PERCENT = 60;
const LETTER_PATTERN = /\p{Letter}/gu;
const PLACEHOLDER_PATTERN = /\{\{\s*[^}]+\s*\}\}/g;
const GENERATED_PLACEHOLDER_PATTERN = /__AURA_PLACEHOLDER_\d+__/g;

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

const stripPlaceholders = (value = '') => String(value)
    .replace(PLACEHOLDER_PATTERN, ' ')
    .replace(GENERATED_PLACEHOLDER_PATTERN, ' ');

const normalizeForFallbackCheck = (value = '') => stripPlaceholders(value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US');

const countMatches = (value, pattern) => (String(value).match(pattern) || []).length;

const countLetters = (value) => countMatches(value, LETTER_PATTERN);

const countNativeLetters = (value, patterns) => {
    const letters = String(value).match(LETTER_PATTERN) || [];
    return letters.filter((letter) => patterns.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(letter);
    })).length;
};

const formatPercent = (value) => (
    Number.isFinite(value) ? `${value.toFixed(1)}%` : 'n/a'
);

const formatCsvPercent = (value) => {
    if (!Number.isFinite(value)) return '';
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
};

const csvCell = (value) => {
    const normalizedValue = value == null ? '' : String(value);
    if (!/[",\n]/.test(normalizedValue)) return normalizedValue;
    return `"${normalizedValue.replace(/"/g, '""')}"`;
};

const getSampleKeys = (row) => [
    ...row.missingKeys,
    ...row.exactEnglishKeys,
    ...row.zeroNativeScriptKeys,
].slice(0, 8);

await ensureAllMarketMessagesLoaded();

const supportedLanguageCodes = SUPPORTED_LANGUAGES.map((language) => language.code);
const localeCodes = supportedLanguageCodes.filter((code) => code !== SOURCE_LANGUAGE);
const englishMessages = MARKET_MESSAGES[SOURCE_LANGUAGE] || {};
const canonicalKeys = Object.keys(englishMessages)
    .filter((key) => typeof englishMessages[key] === 'string' && englishMessages[key].trim().length > 0)
    .sort((left, right) => left.localeCompare(right));

if (canonicalKeys.length === 0) {
    throw new Error('No canonical English locale messages found.');
}

const rows = localeCodes.map((locale) => {
    const messages = MARKET_MESSAGES[locale] || {};
    const nativeRule = NATIVE_SCRIPT_RULES[locale];
    const missingKeys = [];
    const exactEnglishKeys = [];
    const zeroNativeScriptKeys = [];
    let nativeScriptKeyHits = 0;
    let nativeLetterCount = 0;
    let translatedLetterCount = 0;

    canonicalKeys.forEach((key) => {
        const englishText = englishMessages[key];
        const translatedText = messages[key];

        if (typeof translatedText !== 'string' || translatedText.trim().length === 0) {
            missingKeys.push(key);
            return;
        }

        if (normalizeForFallbackCheck(translatedText) === normalizeForFallbackCheck(englishText)) {
            exactEnglishKeys.push(key);
        }

        if (!nativeRule) return;

        const qualityText = stripPlaceholders(translatedText);
        const letters = countLetters(qualityText);
        const nativeLetters = countNativeLetters(qualityText, nativeRule.patterns);

        if (letters > 0) {
            translatedLetterCount += letters;
            nativeLetterCount += nativeLetters;
        }

        if (nativeLetters > 0) {
            nativeScriptKeyHits += 1;
        } else {
            zeroNativeScriptKeys.push(key);
        }
    });

    const exactEnglishPercent = (exactEnglishKeys.length / canonicalKeys.length) * 100;
    const nativeScriptKeyPercent = nativeRule
        ? (nativeScriptKeyHits / canonicalKeys.length) * 100
        : null;
    const nativeLetterPercent = nativeRule && translatedLetterCount > 0
        ? (nativeLetterCount / translatedLetterCount) * 100
        : null;
    const failReasons = [];

    if (missingKeys.length > 0) {
        failReasons.push(`${missingKeys.length} missing key(s)`);
    }

    if (exactEnglishPercent > MAX_EXACT_ENGLISH_PERCENT) {
        failReasons.push(`exact English fallback ${formatPercent(exactEnglishPercent)} > ${MAX_EXACT_ENGLISH_PERCENT}%`);
    }

    if (nativeRule && nativeLetterPercent < MIN_NATIVE_LETTER_PERCENT) {
        failReasons.push(`${nativeRule.label} letter share ${formatPercent(nativeLetterPercent)} < ${MIN_NATIVE_LETTER_PERCENT}%`);
    }

    return {
        locale,
        totalKeys: canonicalKeys.length,
        missingKeys,
        exactEnglishKeys,
        exactEnglishPercent,
        nativeRule,
        nativeScriptKeyHits,
        nativeScriptKeyPercent,
        nativeLetterPercent,
        zeroNativeScriptKeys,
        failReasons,
    };
});

const csvLines = [
    [
        'language',
        'total_keys',
        'missing_keys',
        'exact_english_matches',
        'exact_english_percent',
        'native_script_rule',
        'native_script_key_hits',
        'native_script_key_percent',
        'native_letter_percent',
        'status',
    ].join(','),
    ...rows.map((row) => [
        row.locale,
        row.totalKeys,
        row.missingKeys.length,
        row.exactEnglishKeys.length,
        formatCsvPercent(row.exactEnglishPercent),
        row.nativeRule?.label || '',
        row.nativeRule ? row.nativeScriptKeyHits : '',
        row.nativeRule ? formatCsvPercent(row.nativeScriptKeyPercent) : '',
        row.nativeRule ? formatCsvPercent(row.nativeLetterPercent) : '',
        row.failReasons.length > 0 ? 'fail' : 'pass',
    ].map(csvCell).join(',')),
];

fs.writeFileSync(qualityCsvPath, `${csvLines.join('\n')}\n`, 'utf8');

console.log('Locale quality audit');
console.log(`Canonical English keys: ${canonicalKeys.length}`);
console.log(`Exact English fallback ceiling: ${MAX_EXACT_ENGLISH_PERCENT}%`);
console.log(`Native-script letter floor: ${MIN_NATIVE_LETTER_PERCENT}%`);
console.log(`Mode: ${isReportOnly ? 'report-only' : 'strict'}`);
console.log('');

rows.forEach((row) => {
    const details = [
        `exact English ${formatPercent(row.exactEnglishPercent)} (${row.exactEnglishKeys.length}/${row.totalKeys})`,
    ];

    if (row.nativeRule) {
        details.push(`${row.nativeRule.label} keys ${formatPercent(row.nativeScriptKeyPercent)} (${row.nativeScriptKeyHits}/${row.totalKeys})`);
        details.push(`${row.nativeRule.label} letters ${formatPercent(row.nativeLetterPercent)}`);
    }

    console.log(`- ${row.locale}: ${row.failReasons.length > 0 ? 'FAIL' : 'PASS'} | ${details.join(' | ')}`);

    if (row.failReasons.length === 0) return;

    console.log(`  reasons: ${row.failReasons.join('; ')}`);

    getSampleKeys(row).forEach((key) => {
        const value = MARKET_MESSAGES[row.locale]?.[key] || '';
        console.log(`  sample ${key}: ${JSON.stringify(value)}`);
    });
});

console.log('');
console.log(`Quality snapshot: ${path.relative(appDir, qualityCsvPath).replace(/\\/g, '/')}`);

if (!isReportOnly && rows.some((row) => row.failReasons.length > 0)) {
    process.exitCode = 1;
}
