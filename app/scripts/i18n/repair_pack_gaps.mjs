import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Repairs market message packs where keys still copy the en value by
// translating them through the Google translate_a/t endpoint (same upstream
// the original Indic pack generation used in #195).
//
// Usage: node scripts/i18n/repair_pack_gaps.mjs [--languages=bn,hi] [--dry-run]

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACK_ROOT = path.resolve(__dirname, '..', '..', 'src', 'config', 'marketMessagePacks');
const SOURCE_LANGUAGE = 'en';
const BATCH_SIZE = 25;
const CONCURRENCY = 3;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const languagesArg = args.find((a) => a.startsWith('--languages='));
const ALL_LOCALES = ['ar', 'as', 'bn', 'de', 'es', 'fr', 'gu', 'hi', 'ja', 'kn', 'ml', 'mr', 'or', 'pa', 'pt', 'sa', 'te', 'ur', 'zh'];
const LOCALES = languagesArg ? languagesArg.split('=')[1].split(',') : ALL_LOCALES;

const TARGET_CODES = { zh: 'zh-CN' };

// Rough native-script expectations, used to reject outputs that came back
// untranslated (Latin copy of the source).
const NATIVE_SCRIPT = [
  { codes: ['ar', 'ur'], pattern: /[\u0600-\u06FF\u0750-\u077F]/ },
  { codes: ['as', 'bn'], pattern: /[\u0980-\u09FF]/ },
  { codes: ['gu'], pattern: /[\u0A80-\u0AFF]/ },
  { codes: ['hi', 'mr', 'sa'], pattern: /[\u0900-\u097F]/ },
  { codes: ['kn'], pattern: /[\u0C80-\u0CFF]/ },
  { codes: ['ml'], pattern: /[\u0D00-\u0D7F]/ },
  { codes: ['or'], pattern: /[\u0B00-\u0B7F]/ },
  { codes: ['pa'], pattern: /[\u0A00-\u0A7F]/ },
  { codes: ['te'], pattern: /[\u0C00-\u0C7F]/ },
  { codes: ['ja'], pattern: /[\u3040-\u30FF\u4E00-\u9FFF]/ },
  { codes: ['zh'], pattern: /[\u4E00-\u9FFF]/ },
  { codes: ['de', 'es', 'fr', 'pt'], pattern: /[A-Za-zÀ-ÿ]/ },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const protectPlaceholders = (text) => {
  const placeholders = [];
  const protectedText = String(text).replace(/\{\{?[^{}]+\}?\}/g, (match) => {
    placeholders.push(match);
    return `__P${placeholders.length - 1}__`;
  });
  return { protectedText, placeholders };
};

const restorePlaceholders = (text, placeholders) =>
  String(text).replace(/__P(\d+)__/g, (match, index) => placeholders[Number(index)] ?? match);

const isTranslatable = (text) =>
  /[A-Za-z]{2,}/.test(text) && !/^https?:\/\//.test(text);

const hasNativeScript = (locale, text) => {
  const rule = NATIVE_SCRIPT.find((entry) => entry.codes.includes(locale));
  return !rule || rule.pattern.test(text);
};

const translateBatch = async (texts, locale) => {
  const target = TARGET_CODES[locale] || locale;
  const protectedBatch = texts.map((text) => protectPlaceholders(text));
  const query = new URLSearchParams({ client: 'dict-chrome-ex', sl: SOURCE_LANGUAGE, tl: target });
  protectedBatch.forEach(({ protectedText }) => query.append('q', protectedText));

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`https://clients5.google.com/translate_a/t?${query.toString()}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'AuraCommerce/1.0' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`upstream ${response.status}`);
      const payload = await response.json();
      const lines = Array.isArray(payload)
        ? payload.map((entry) => (Array.isArray(entry) ? entry[0] : entry))
        : [payload];
      if (lines.length !== texts.length) throw new Error(`batch size mismatch ${lines.length}/${texts.length}`);
      return texts.map((original, index) => {
        const restored = restorePlaceholders(String(lines[index] ?? ''), protectedBatch[index].placeholders);
        return restored && hasNativeScript(locale, restored) ? restored : original;
      });
    } catch (error) {
      if (attempt >= 5) {
        console.warn(`  ! ${locale}: batch failed after ${attempt} attempts (${error.message}); keeping en`);
        return texts;
      }
      await sleep(1500 * attempt);
    } finally {
      clearTimeout(timeoutId);
    }
  }
};

const rewritePackValue = (source, key, value) => {
  const linePattern = new RegExp(`^(\\s*"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"(,?)$`, 'm');
  const nextLine = `${JSON.stringify(key)}: ${JSON.stringify(value)},`;
  return linePattern.test(source)
    ? source.replace(linePattern, `  ${nextLine}`)
    : source.replace(
        new RegExp(`^(\\s*${JSON.stringify(key)}\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"(,?)$`, 'm'),
        `  ${nextLine}`,
      );
};

const { MARKET_MESSAGE_PACK: EN_PACK } = await import(pathToFileURL(path.join(PACK_ROOT, 'en.js')).href);
const enKeys = Object.keys(EN_PACK);

// Keys whose legacy values (e.g. old "Delta Offset" placeholder translations)
// must be retranslated from the current en value even when they no longer
// match it.
const FORCE_KEYS = new Set(['cart.summary.discount']);
const parseListArg = (prefix) => {
  const arg = args.find((a) => a.startsWith(prefix));
  return arg ? arg.split('=')[1].split(',') : null;
};

for (const locale of LOCALES) {
  const packPath = path.join(PACK_ROOT, `${locale}.js`);
  const { MARKET_MESSAGE_PACK: pack } = await import(pathToFileURL(packPath).href);
  const onlyKeys = parseListArg('--keys=');
  const copiedKeys = enKeys.filter((key) => (
    (onlyKeys ? onlyKeys.includes(key) : pack[key] === EN_PACK[key] || FORCE_KEYS.has(key))
    && isTranslatable(EN_PACK[key])
  ));

  // Dedup identical en values within the locale to cut request volume.
  const valueToKeys = new Map();
  for (const key of copiedKeys) {
    const list = valueToKeys.get(EN_PACK[key]) || [];
    list.push(key);
    valueToKeys.set(EN_PACK[key], list);
  }
  const uniqueValues = [...valueToKeys.keys()];
  const batches = [];
  for (let i = 0; i < uniqueValues.length; i += BATCH_SIZE) {
    batches.push(uniqueValues.slice(i, i + BATCH_SIZE));
  }

  const translations = new Map();
  let completed = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (batches.length > 0) {
      const batch = batches.shift();
      const translated = await translateBatch(batch, locale);
      batch.forEach((value, index) => translations.set(value, translated[index]));
      completed += batch.length;
      if (completed % 250 < BATCH_SIZE) console.log(`  ${locale}: ${completed}/${uniqueValues.length}`);
      await sleep(250);
    }
  });
  await Promise.all(workers);

  let source = fs.readFileSync(packPath, 'utf8');
  let changed = 0;
  for (const [value, translated] of translations) {
    if (translated === value) continue;
    for (const key of valueToKeys.get(value)) {
      const updated = rewritePackValue(source, key, translated);
      if (updated !== source) {
        source = updated;
        changed += 1;
      }
    }
  }
  console.log(`${locale}: ${copiedKeys.length} copied keys, ${changed} rewritten`);
  if (!dryRun && changed > 0) fs.writeFileSync(packPath, source);
}
