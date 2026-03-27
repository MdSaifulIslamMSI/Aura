import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MARKET_MESSAGES, SUPPORTED_LANGUAGES } from './marketConfig';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SRC_ROOT = path.resolve(__dirname, '..');
const SOURCE_KEY_PATTERN = /\bt\(\s*['"]([^'"]+)['"]\s*,/g;
const SOURCE_FILE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build']);
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

const collectLiteralSourceKeys = (directoryPath, keys = new Set()) => {
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        collectLiteralSourceKeys(path.join(directoryPath, entry.name), keys);
      }
      continue;
    }

    if (!SOURCE_FILE_EXTENSIONS.has(path.extname(entry.name))) continue;
    if (entry.name.includes('.test.') || entry.name.includes('.spec.')) continue;
    if (entry.name === 'generatedMarketMessages.js') continue;

    const source = fs.readFileSync(path.join(directoryPath, entry.name), 'utf8');
    const matches = source.matchAll(SOURCE_KEY_PATTERN);
    for (const match of matches) {
      if (match[1]) {
        keys.add(match[1]);
      }
    }
  }

  return keys;
};

describe('MARKET_MESSAGES coverage', () => {
  it('covers every source translation key for each supported language', () => {
    const sourceKeys = collectLiteralSourceKeys(SRC_ROOT);
    DYNAMIC_SOURCE_KEYS.forEach((key) => sourceKeys.add(key));

    expect(sourceKeys.size).toBeGreaterThan(0);

    for (const language of SUPPORTED_LANGUAGES) {
      const messages = MARKET_MESSAGES[language.code] || {};
      const missingKeys = [...sourceKeys].filter((key) => (
        typeof messages[key] !== 'string' || messages[key].length === 0
      ));

      expect(missingKeys, `${language.code} is missing ${missingKeys.length} message(s): ${missingKeys.join(', ')}`).toEqual([]);
    }
  });
});
