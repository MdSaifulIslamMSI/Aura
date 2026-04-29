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
const srcDir = path.resolve(scriptDir, '../src');
const coverageCsvPath = path.resolve(appDir, 'translation-coverage.csv');

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const IGNORE_FILE_PATTERN = /\.(test|spec)\.[jt]sx?$/i;
const TRANSLATION_CALL_PATTERN = /\bt\(\s*(['"])([^'"`\r\n]+)\1/g;
const DYNAMIC_SOURCE_KEYS = [
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

const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((language) => language.code);
const localeCodes = SUPPORTED_LANGUAGE_CODES.filter((code) => code !== 'en');

const getAreaName = (filePath = '') => {
    const normalizedPath = filePath.replace(/\\/g, '/');

    if (normalizedPath.includes('/src/pages/Admin/')) return 'Admin';
    if (normalizedPath.includes('/src/pages/Profile/')) return 'Profile';
    if (
        normalizedPath.includes('/src/pages/BecomeSeller/')
        || normalizedPath.includes('/src/pages/MyListings/')
        || normalizedPath.includes('/src/pages/Sell/')
        || normalizedPath.includes('/src/pages/SellerProfile/')
    ) {
        return 'Seller';
    }
    if (
        normalizedPath.includes('/src/pages/AICompare/')
        || normalizedPath.includes('/src/pages/Bundles/')
        || normalizedPath.includes('/src/pages/MissionControl/')
        || normalizedPath.includes('/src/pages/PriceAlerts/')
        || normalizedPath.includes('/src/pages/TradeIn/')
        || normalizedPath.includes('/src/pages/VisualSearch/')
    ) {
        return 'Discovery';
    }
    if (normalizedPath.includes('/src/components/')) return 'Shared UI';
    if (
        normalizedPath.includes('/src/pages/')
        || normalizedPath.includes('/src/context/')
        || normalizedPath.includes('/src/config/')
    ) {
        return 'Storefront';
    }
    return 'Other';
};

const formatPercent = (resolved, total) => {
    if (total === 0) return '100.0%';
    return `${((resolved / total) * 100).toFixed(1)}%`;
};

const formatCsvPercent = (resolved, total) => {
    if (total === 0) return '100';
    const value = (resolved / total) * 100;
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
};

const getReferenceTextLength = (marketMessages, key) => String(
    marketMessages.en?.[key] || key
).length;

const writeCoverageCsv = (marketMessages, requiredKeys) => {
    const sortedRequiredKeys = [...requiredKeys].sort((left, right) => left.localeCompare(right));
    const totalLetters = sortedRequiredKeys.reduce((total, key) => (
        total + getReferenceTextLength(marketMessages, key)
    ), 0);

    const lines = [
        'language,key_coverage_percent,letter_coverage_percent,covered_keys,total_keys,covered_letters,total_letters',
        ...SUPPORTED_LANGUAGE_CODES.map((languageCode) => {
            const messages = marketMessages[languageCode] || {};
            const coveredKeys = languageCode === 'en'
                ? sortedRequiredKeys
                : sortedRequiredKeys.filter((key) => (
                    typeof messages[key] === 'string' && messages[key].length > 0
                ));
            const coveredLetters = coveredKeys.reduce((total, key) => (
                total + getReferenceTextLength(marketMessages, key)
            ), 0);

            return [
                languageCode,
                formatCsvPercent(coveredKeys.length, sortedRequiredKeys.length),
                formatCsvPercent(coveredLetters, totalLetters),
                coveredKeys.length,
                sortedRequiredKeys.length,
                coveredLetters,
                totalLetters,
            ].join(',');
        }),
    ];

    fs.writeFileSync(coverageCsvPath, `${lines.join('\n')}\n`, 'utf8');
};

const walkSourceFiles = (directoryPath) => {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    const files = [];

    entries.forEach((entry) => {
        const resolvedPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkSourceFiles(resolvedPath));
            return;
        }

        const extension = path.extname(entry.name);
        if (!SOURCE_EXTENSIONS.has(extension) || IGNORE_FILE_PATTERN.test(entry.name)) {
            return;
        }

        files.push(resolvedPath);
    });

    return files;
};

const staticKeys = new Set();
const areaKeyMap = new Map();
const keyFileMap = new Map();
const filesWithKeys = new Set();

await ensureAllMarketMessagesLoaded();

walkSourceFiles(srcDir).forEach((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const fileKeys = new Set();
    let match = TRANSLATION_CALL_PATTERN.exec(source);

    while (match) {
        const key = String(match[2] || '').trim();
        if (key && !key.includes('${')) {
            fileKeys.add(key);
        }
        match = TRANSLATION_CALL_PATTERN.exec(source);
    }

    if (fileKeys.size === 0) return;

    filesWithKeys.add(filePath);
    const areaName = getAreaName(filePath);
    const areaKeys = areaKeyMap.get(areaName) || new Set();

    fileKeys.forEach((key) => {
        staticKeys.add(key);
        areaKeys.add(key);

        const filesForKey = keyFileMap.get(key) || new Set();
        filesForKey.add(path.relative(srcDir, filePath).replace(/\\/g, '/'));
        keyFileMap.set(key, filesForKey);
    });

    areaKeyMap.set(areaName, areaKeys);
    TRANSLATION_CALL_PATTERN.lastIndex = 0;
});

const requiredKeys = new Set([
    ...staticKeys,
    ...DYNAMIC_SOURCE_KEYS,
    ...Object.keys(MARKET_MESSAGES.en || {}),
]);
const sortedKeys = [...requiredKeys].sort((left, right) => left.localeCompare(right));
const missingByLocale = Object.fromEntries(localeCodes.map((locale) => [locale, []]));
const resolvedCountByLocale = Object.fromEntries(localeCodes.map((locale) => [locale, 0]));

sortedKeys.forEach((key) => {
    localeCodes.forEach((locale) => {
        const localeMessages = MARKET_MESSAGES[locale] || {};
        if (Object.prototype.hasOwnProperty.call(localeMessages, key)) {
            resolvedCountByLocale[locale] += 1;
            return;
        }
        missingByLocale[locale].push(key);
    });
});

console.log('Locale coverage audit');
console.log(`Source files scanned: ${walkSourceFiles(srcDir).length}`);
console.log(`Runtime files with static translation keys: ${filesWithKeys.size}`);
console.log(`Required translation keys: ${sortedKeys.length}`);
console.log(`Required English pack keys: ${Object.keys(MARKET_MESSAGES.en || {}).length}`);
console.log('');
console.log('Overall locale coverage:');
localeCodes.forEach((locale) => {
    const resolvedCount = resolvedCountByLocale[locale];
    console.log(`- ${locale}: ${formatPercent(resolvedCount, sortedKeys.length)} (${resolvedCount}/${sortedKeys.length})`);
});

console.log('');
console.log('Area coverage:');
[...areaKeyMap.entries()]
    .sort(([leftArea], [rightArea]) => leftArea.localeCompare(rightArea))
    .forEach(([areaName, keys]) => {
        const sortedAreaKeys = [...keys];
        const coverageLabel = localeCodes.map((locale) => {
            const resolvedCount = sortedAreaKeys.filter((key) => (
                Object.prototype.hasOwnProperty.call(MARKET_MESSAGES[locale] || {}, key)
            )).length;
            return `${locale} ${formatPercent(resolvedCount, sortedAreaKeys.length)}`;
        }).join(' | ');

        console.log(`- ${areaName}: ${sortedAreaKeys.length} keys | ${coverageLabel}`);
    });

writeCoverageCsv(MARKET_MESSAGES, requiredKeys);
console.log('');
console.log(`Coverage snapshot: ${path.relative(appDir, coverageCsvPath).replace(/\\/g, '/')}`);

const missingEntries = sortedKeys
    .map((key) => ({
        key,
        locales: localeCodes.filter((locale) => missingByLocale[locale].includes(key)),
        files: [...(keyFileMap.get(key) || [])].sort(),
    }))
    .filter((entry) => entry.locales.length > 0);

if (missingEntries.length === 0) {
    console.log('');
    console.log('No missing locale keys found for static runtime translations.');
    process.exit(0);
}

console.log('');
console.log('Missing locale keys:');
missingEntries.forEach((entry) => {
    console.log(`- ${entry.key}`);
    console.log(`  locales: ${entry.locales.join(', ')}`);
    console.log(`  files: ${entry.files.join(', ')}`);
});

process.exitCode = 1;
