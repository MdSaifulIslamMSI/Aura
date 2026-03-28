import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PRIORITY_MARKET_MESSAGES } from '../src/config/priorityMarketMessages.js';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(APP_ROOT, 'src');
const CONFIG_ROOT = path.join(SRC_ROOT, 'config');
const MARKET_CONFIG_PATH = path.join(CONFIG_ROOT, 'marketConfig.js');
const GENERATED_MESSAGES_PATH = path.join(CONFIG_ROOT, 'generatedMarketMessages.js');

const SOURCE_LANGUAGE = 'en';
const SUPPORTED_LANGUAGE_CODES = ['en', 'hi', 'es', 'fr', 'de', 'ar', 'ja', 'pt', 'zh'];
const SOURCE_FILE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build']);
const PLACEHOLDER_PATTERN = /\{\{\s*([^}\s]+)\s*\}\}/g;
const MAX_TRANSLATION_ATTEMPTS = 4;
const TRANSLATION_CONCURRENCY = 4;
const CONFLICT_OVERRIDES = {
  'checkout.default': 'Default',
};

const PRODUCT_CARD_MESSAGE_FALLBACKS = {
  'product.goodDeal': 'Good Deal',
  'product.skipNow': 'Skip For Now',
  'product.watchPrice': 'Watch Price',
  'product.reviewSignal': 'Review Signal',
};

const BACKEND_STATUS_DYNAMIC_KEYS = [
  'status.unavailableTitle',
  'status.unavailableMessage',
  'status.warmingTitle',
  'status.warmingMessage',
  'status.degradedTitle',
  'status.degradedMessage',
];

const parseModule = (source, filename) => parser.parse(source, {
  sourceType: 'module',
  sourceFilename: filename,
  plugins: ['jsx'],
});

const getNodeText = (source, node) => source.slice(node.start, node.end);

const normalizeExpressionText = (value = '') => String(value || '')
  .replace(/\s+/g, '')
  .replace(/;+/g, '')
  .trim();

const getPropertyName = (node) => {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'StringLiteral') return node.value;
  return '';
};

const extractStringProperties = (objectNode) => {
  const result = {};
  if (!objectNode || objectNode.type !== 'ObjectExpression') return result;

  for (const property of objectNode.properties) {
    if (property.type !== 'ObjectProperty') continue;
    const key = getPropertyName(property.key);
    if (!key || property.value.type !== 'StringLiteral') continue;
    result[key] = property.value.value;
  }

  return result;
};

const readFile = (targetPath) => fs.readFileSync(targetPath, 'utf8');

const parseJavaScriptFile = (targetPath) => {
  const source = readFile(targetPath);
  const ast = parseModule(source, targetPath);
  return { source, ast };
};

const resolveLiteralSerialization = (node, source) => {
  if (!node) return null;

  switch (node.type) {
    case 'StringLiteral':
      return node.value;
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return String(node.value);
    case 'CallExpression':
    case 'OptionalCallExpression':
      if (node.callee.type === 'Identifier' && node.callee.name === 't' && node.arguments[2]) {
        return resolveLiteralSerialization(node.arguments[2], source);
      }
      return null;
    case 'TemplateLiteral': {
      let output = '';
      for (let index = 0; index < node.quasis.length; index += 1) {
        output += node.quasis[index]?.value?.cooked || '';
        if (index >= node.expressions.length) continue;
        const literalValue = resolveLiteralSerialization(node.expressions[index], source);
        if (literalValue == null) return null;
        output += literalValue;
      }
      return output;
    }
    default:
      return null;
  }
};

const serializeExpressionForMatching = (node, source) => {
  if (!node) return '';

  switch (node.type) {
    case 'StringLiteral':
      return normalizeExpressionText(node.value);
    case 'NumericLiteral':
    case 'BooleanLiteral':
      return String(node.value);
    case 'NullLiteral':
      return 'null';
    case 'Identifier':
      return node.name;
    case 'MemberExpression':
    case 'OptionalMemberExpression':
    case 'CallExpression':
    case 'OptionalCallExpression':
      if (
        (node.type === 'CallExpression' || node.type === 'OptionalCallExpression')
        && node.callee.type === 'Identifier'
        && node.callee.name === 't'
        && node.arguments[2]
      ) {
        return serializeExpressionForMatching(node.arguments[2], source);
      }
      return normalizeExpressionText(getNodeText(source, node));
    case 'LogicalExpression':
    case 'BinaryExpression':
      return `${serializeExpressionForMatching(node.left, source)}${node.operator}${serializeExpressionForMatching(node.right, source)}`;
    case 'ConditionalExpression':
      return `${serializeExpressionForMatching(node.test, source)}?${serializeExpressionForMatching(node.consequent, source)}:${serializeExpressionForMatching(node.alternate, source)}`;
    case 'UnaryExpression':
      return `${node.operator}${serializeExpressionForMatching(node.argument, source)}`;
    case 'TemplateLiteral': {
      let output = '`';
      for (let index = 0; index < node.quasis.length; index += 1) {
        output += normalizeExpressionText(node.quasis[index]?.value?.cooked || '');
        if (index < node.expressions.length) {
          const literalValue = resolveLiteralSerialization(node.expressions[index], source);
          output += literalValue == null
            ? `\${${serializeExpressionForMatching(node.expressions[index], source)}}`
            : normalizeExpressionText(literalValue);
        }
      }
      output += '`';
      return output;
    }
    default:
      return normalizeExpressionText(getNodeText(source, node));
  }
};

const collectManualMessages = () => {
  const { ast } = parseJavaScriptFile(MARKET_CONFIG_PATH);
  const englishMessages = {};
  const manualOverrides = {};

  traverse(ast, {
    VariableDeclarator(currentPath) {
      const { node } = currentPath;
      if (node.id.type !== 'Identifier' || !node.init) return;

      if (node.id.name === 'EN_MESSAGES' && node.init.type === 'ObjectExpression') {
        Object.assign(englishMessages, extractStringProperties(node.init));
        return;
      }

      if (node.id.name !== 'SIMPLE_OVERRIDES' || node.init.type !== 'ObjectExpression') {
        return;
      }

      for (const property of node.init.properties) {
        if (property.type !== 'ObjectProperty' || property.value.type !== 'ObjectExpression') continue;
        const languageCode = getPropertyName(property.key);
        if (!languageCode) continue;
        manualOverrides[languageCode] = extractStringProperties(property.value);
      }
    },
  });

  const manualMessages = { en: englishMessages };
  for (const languageCode of SUPPORTED_LANGUAGE_CODES.filter((code) => code !== SOURCE_LANGUAGE)) {
    manualMessages[languageCode] = {
      ...(manualOverrides[languageCode] || {}),
      ...(PRIORITY_MARKET_MESSAGES[languageCode] || {}),
    };
  }

  return manualMessages;
};

const buildValueLookup = (valuesNode, source) => {
  const lookup = new Map();
  if (!valuesNode || valuesNode.type !== 'ObjectExpression') return lookup;

  for (const property of valuesNode.properties) {
    if (property.type !== 'ObjectProperty') continue;
    const key = getPropertyName(property.key);
    if (!key) continue;
    lookup.set(serializeExpressionForMatching(property.value, source), key);
  }

  return lookup;
};

const templateLiteralToMessage = (templateNode, valueLookup, source, key) => {
  let output = '';

  for (let index = 0; index < templateNode.quasis.length; index += 1) {
    output += templateNode.quasis[index]?.value?.cooked || '';
    if (index >= templateNode.expressions.length) continue;

    const expression = templateNode.expressions[index];
    const expressionSource = serializeExpressionForMatching(expression, source);
    const matchedToken = valueLookup.get(expressionSource);
    if (matchedToken) {
      output += `{{${matchedToken}}}`;
      continue;
    }

    if (expression.type === 'StringLiteral' || expression.type === 'NumericLiteral' || expression.type === 'BooleanLiteral') {
      output += String(expression.value);
      continue;
    }

    throw new Error(`Unable to map template expression for ${key}: ${getNodeText(source, expression)}`);
  }

  return output;
};

const extractFallbackMessage = ({ key, valuesNode, fallbackNode, source, filename }) => {
  if (!fallbackNode) return '';
  if (fallbackNode.type === 'StringLiteral') return fallbackNode.value;
  if (fallbackNode.type === 'TemplateLiteral') {
    return templateLiteralToMessage(fallbackNode, buildValueLookup(valuesNode, source), source, `${key} (${path.basename(filename)})`);
  }
  return '';
};

const walkSourceFiles = (directoryPath, callback) => {
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        walkSourceFiles(path.join(directoryPath, entry.name), callback);
      }
      continue;
    }

    const extension = path.extname(entry.name);
    if (!SOURCE_FILE_EXTENSIONS.has(extension)) continue;
    if (entry.name.includes('.test.') || entry.name.includes('.spec.')) continue;

    callback(path.join(directoryPath, entry.name));
  }
};

const addCandidate = (candidateMap, key, message) => {
  const normalizedKey = String(key || '').trim();
  const normalizedMessage = String(message || '').trim();
  if (!normalizedKey || !normalizedMessage) return;

  const choices = candidateMap.get(normalizedKey) || new Map();
  choices.set(normalizedMessage, (choices.get(normalizedMessage) || 0) + 1);
  candidateMap.set(normalizedKey, choices);
};

const collectDirectSourceMessages = () => {
  const usedKeys = new Set();
  const candidates = new Map();

  walkSourceFiles(SRC_ROOT, (filePath) => {
    if (path.resolve(filePath) === path.resolve(GENERATED_MESSAGES_PATH)) return;

    const source = readFile(filePath);
    let ast;
    try {
      ast = parseModule(source, filePath);
    } catch {
      return;
    }

    traverse(ast, {
      CallExpression(currentPath) {
        const { node } = currentPath;
        if (node.callee.type !== 'Identifier' || node.callee.name !== 't') return;

        const [keyNode, valuesNode, fallbackNode] = node.arguments;
        if (!keyNode || keyNode.type !== 'StringLiteral') return;

        const key = keyNode.value;
        usedKeys.add(key);

        const fallbackMessage = extractFallbackMessage({
          key,
          valuesNode,
          fallbackNode,
          source,
          filename: filePath,
        });

        if (fallbackMessage) {
          addCandidate(candidates, key, fallbackMessage);
        }
      },
    });
  });

  return { usedKeys, candidates };
};

const extractPaymentOptionMessages = () => {
  const filePath = path.join(SRC_ROOT, 'pages', 'Checkout', 'components', 'StepPayment.jsx');
  const { ast } = parseJavaScriptFile(filePath);
  const output = {};

  traverse(ast, {
    VariableDeclarator(currentPath) {
      const { node } = currentPath;
      if (node.id.type !== 'Identifier' || !node.init) return;

      if (node.id.name === 'PAYMENT_OPTIONS' && node.init.type === 'ArrayExpression') {
        for (const element of node.init.elements) {
          if (!element || element.type !== 'ObjectExpression') continue;
          const values = extractStringProperties(element);
          if (values.titleKey && values.titleFallback) {
            output[values.titleKey] = values.titleFallback;
          }
          if (values.descriptionKey && values.descriptionFallback) {
            output[values.descriptionKey] = values.descriptionFallback;
          }
        }
      }

      if (node.id.name === 'RAIL_SUMMARY' && node.init.type === 'ObjectExpression') {
        for (const property of node.init.properties) {
          if (property.type !== 'ObjectProperty' || property.value.type !== 'ObjectExpression') continue;
          const values = extractStringProperties(property.value);
          if (values.titleKey && values.titleFallback) {
            output[values.titleKey] = values.titleFallback;
          }
          if (values.emptyKey && values.emptyFallback) {
            output[values.emptyKey] = values.emptyFallback;
          }
        }
      }
    },
  });

  return output;
};

const extractAddressTypeMessages = () => {
  const filePath = path.join(SRC_ROOT, 'pages', 'Checkout', 'components', 'StepAddress.jsx');
  const { ast } = parseJavaScriptFile(filePath);
  const output = {};

  traverse(ast, {
    VariableDeclarator(currentPath) {
      const { node } = currentPath;
      if (node.id.type !== 'Identifier' || node.id.name !== 'ADDRESS_TYPES' || !node.init || node.init.type !== 'ArrayExpression') {
        return;
      }

      for (const element of node.init.elements) {
        if (!element || element.type !== 'StringLiteral') continue;
        output[`checkout.addressType.${element.value}`] = element.value;
      }
    },
  });

  return output;
};

const resolveCandidateMessages = (candidateMap, manualEnglishMessages) => {
  const resolved = {};

  for (const [key, messageChoices] of candidateMap.entries()) {
    if (manualEnglishMessages[key]) {
      resolved[key] = manualEnglishMessages[key];
      continue;
    }

    if (CONFLICT_OVERRIDES[key]) {
      resolved[key] = CONFLICT_OVERRIDES[key];
      continue;
    }

    const sortedChoices = [...messageChoices.entries()].sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      if (right[0].length !== left[0].length) return right[0].length - left[0].length;
      return left[0].localeCompare(right[0]);
    });

    if (sortedChoices[0]) {
      resolved[key] = sortedChoices[0][0];
    }
  }

  return resolved;
};

const buildCanonicalEnglishMessages = () => {
  const manualMessages = collectManualMessages();
  const { usedKeys, candidates } = collectDirectSourceMessages();
  const dynamicMessages = {
    ...extractPaymentOptionMessages(),
    ...extractAddressTypeMessages(),
    ...PRODUCT_CARD_MESSAGE_FALLBACKS,
  };

  const englishMessages = {
    ...resolveCandidateMessages(candidates, manualMessages.en),
    ...dynamicMessages,
    ...CONFLICT_OVERRIDES,
    ...manualMessages.en,
  };

  const allUsedKeys = new Set([
    ...usedKeys,
    ...Object.keys(dynamicMessages),
    ...BACKEND_STATUS_DYNAMIC_KEYS,
  ]);

  const missingKeys = [...allUsedKeys]
    .filter((key) => !Object.prototype.hasOwnProperty.call(englishMessages, key))
    .sort();

  if (missingKeys.length > 0) {
    throw new Error(`Missing canonical English messages for: ${missingKeys.join(', ')}`);
  }

  return {
    manualMessages,
    englishMessages,
    allKeys: [...new Set([
      ...Object.keys(englishMessages),
      ...allUsedKeys,
    ])].sort((left, right) => left.localeCompare(right)),
  };
};

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

      const translated = await parseTranslationPayload(response);
      return restorePlaceholders(translated || text, placeholders) || text;
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

const generateLanguageMessages = async (languageCode, englishMessages, manualMessages, allKeys) => {
  if (languageCode === SOURCE_LANGUAGE) {
    return Object.fromEntries(allKeys.map((key) => [key, englishMessages[key]]).filter(([, value]) => Boolean(value)));
  }

  const languageManualMessages = manualMessages[languageCode] || {};
  const missingTexts = [...new Set(
    allKeys
      .filter((key) => !Object.prototype.hasOwnProperty.call(languageManualMessages, key))
      .map((key) => englishMessages[key])
      .filter(Boolean),
  )];

  const translations = {};
  await mapWithConcurrency(missingTexts, TRANSLATION_CONCURRENCY, async (text) => {
    translations[text] = await translateSingleText(text, languageCode);
  });

  return Object.fromEntries(allKeys.map((key) => [
    key,
    Object.prototype.hasOwnProperty.call(languageManualMessages, key)
      ? languageManualMessages[key]
      : translations[englishMessages[key]] || englishMessages[key],
  ]));
};

const writeGeneratedMessages = (messagesByLanguage) => {
  const sortedOutput = {};
  for (const languageCode of SUPPORTED_LANGUAGE_CODES) {
    sortedOutput[languageCode] = Object.fromEntries(
      Object.entries(messagesByLanguage[languageCode] || {}).sort(([left], [right]) => left.localeCompare(right)),
    );
  }

  const fileContents = `// Generated by scripts/generate_market_messages.mjs. Do not edit by hand.\nexport const GENERATED_MARKET_MESSAGES = ${JSON.stringify(sortedOutput, null, 2)};\n`;
  fs.writeFileSync(GENERATED_MESSAGES_PATH, fileContents, 'utf8');
};

const main = async () => {
  const { manualMessages, englishMessages, allKeys } = buildCanonicalEnglishMessages();
  const messagesByLanguage = {};

  for (const languageCode of SUPPORTED_LANGUAGE_CODES) {
    messagesByLanguage[languageCode] = await generateLanguageMessages(
      languageCode,
      englishMessages,
      manualMessages,
      allKeys,
    );
    console.log(`${languageCode}: ${Object.keys(messagesByLanguage[languageCode]).length} messages`);
  }

  writeGeneratedMessages(messagesByLanguage);
  console.log(`Wrote ${GENERATED_MESSAGES_PATH}`);
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
