import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  TYPE,
  isStructurallySame,
  parse,
} = require('../../app/node_modules/@formatjs/icu-messageformat-parser');

const REPO_ROOT = process.cwd();
const APP_ROOT = path.join(REPO_ROOT, 'app');
const REVIEWED_DIR = path.join(APP_ROOT, 'src', 'i18n', 'messages', 'reviewed');
const QUALITY_DIR = path.join(APP_ROOT, 'src', 'i18n', 'quality');
const GLOSSARY_DIR = path.join(APP_ROOT, 'src', 'i18n', 'glossary');
const CONFIG_DIR = path.join(APP_ROOT, 'src', 'config');

export const TARGET_LOCALES = [
  'hi', 'bn', 'te', 'mr', 'ur', 'gu', 'pa', 'ml', 'kn', 'or', 'as', 'sa',
  'es', 'fr', 'de', 'ar', 'ja', 'pt', 'zh',
];

export const FLORES_LOCALE_MAP = {
  hi: 'hin_Deva',
  bn: 'ben_Beng',
  te: 'tel_Telu',
  mr: 'mar_Deva',
  ur: 'urd_Arab',
  gu: 'guj_Gujr',
  pa: 'pan_Guru',
  ml: 'mal_Mlym',
  kn: 'kan_Knda',
  or: 'ory_Orya',
  as: 'asm_Beng',
  sa: 'san_Deva',
  es: 'spa_Latn',
  fr: 'fra_Latn',
  de: 'deu_Latn',
  ar: 'arb_Arab',
  ja: 'jpn_Jpan',
  pt: 'por_Latn',
  zh: 'zho_Hans',
};

const NON_LATIN_SCRIPT_PATTERNS = {
  hi: /\p{Script=Devanagari}/gu,
  mr: /\p{Script=Devanagari}/gu,
  sa: /\p{Script=Devanagari}/gu,
  bn: /\p{Script=Bengali}/gu,
  as: /\p{Script=Bengali}/gu,
  te: /\p{Script=Telugu}/gu,
  ur: /\p{Script=Arabic}/gu,
  ar: /\p{Script=Arabic}/gu,
  gu: /\p{Script=Gujarati}/gu,
  pa: /\p{Script=Gurmukhi}/gu,
  ml: /\p{Script=Malayalam}/gu,
  kn: /\p{Script=Kannada}/gu,
  or: /\p{Script=Oriya}/gu,
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu,
  zh: /\p{Script=Han}/gu,
};

const QUESTION_MARK_CORRUPTION_RE = /(?:[\p{L}\p{N}]\?+[\p{L}\p{N}]|\s\?+\s|(?:^|\s)\?{2,}(?:\s|$)|^\?+[\p{L}\p{N}]|\?{2,})/u;
const MOJIBAKE_RE = /(?:\uFFFD|\u00C3[\u0080-\u00BF]|\u00E2\u20AC[\u2122\u0153\u009D\u00A6]|\u00C2[\u00A0-\u00BF]|[\u0000-\u0008\u000B\u000C\u000E-\u001F])/;
const ICU_OR_LEGACY_VAR_RE = /\{\{[^{}]+\}\}|\{[^{}]+\}|<[^>]+>|https?:\/\/\S+|mailto:\S+/g;

const ASCII_STRIPPED_EURO_PATTERNS = {
  es: /\b(?:pais|paises|despues|sesion|resena|resenas|notificacion|vinculo|vinculos|version|cotizacion|exploracion|informacion|accion|operacion|configuracion|navegacion|autenticacion|verificacion|autorizacion|proteccion|comparacion|busqueda|rapido|rapida|telefono|numero|pagina|articulo|unico|valida|valido|codigo|codigos|minimo|maximo|sabado|miercoles|tecnologia|garantia|envio|dia|dias|aqui|atras|mas)\b/iu,
  fr: /\b(?:marche|reglages|preferences|deja|etre|apres|fenetre|arriere|verifie|verifies|verifiee|securite|donnees|numero|telechargement|etat|recu|cout|lie|lies|liee|liees|cree|crees|generer|delai|reseau|egalement|methode|parametres|selectionner|disponibilite|echoue|succes)\b/iu,
  de: /\b(?:Wahrung|Wahrungen|offnen|Offnen|schliessen|Schliessen|uberladen|Verknupfung|verknupft|verfugbar|Verfugbarkeit|fuhren|fur|zuruck|Prufung|prufen|Uber|auswahlen|wahlen|Bestatigung|ungultig|Gultig|schutzen|Qualitat|Moglich|moglich|haufig|anderung|Anderungen|loschen)\b/iu,
  pt: /\b(?:regiao|regioes|configuracoes|configuracao|navegacao|vinculo|vinculos|versao|nao|ja|disponivel|disponiveis|conclusao|informacoes|acoes|acao|numero|notificacao|sessao|avaliacao|avaliacoes|protecao|verificacao|autorizacao|operacao|comparacao|validacao|recuperacao|codigo|rapido|proximo|seguranca|atencao|padrao|catalogo|midia|usuario|cartao|transacao|exclusao)\b/iu,
};

const EURO_GENUINE_COGNATES = {
  es: new Set(['Total', 'Error', 'Original', 'Principal', 'Ideal', 'Local', 'Normal', 'Universal', 'Control']),
  fr: new Set(['Total', 'Menu', 'Support', 'Format', 'Guide', 'Signal', 'Session', 'Options', 'Actions', 'Description']),
  de: new Set([
    'Status', 'Status:', 'Status: {value}', 'Name', 'Format', 'Service', 'Support', 'Online', 'online',
    'Offline', 'Filter', 'Limit', 'Router', 'Snapshot', 'Dashboard', 'Version', 'Details',
    'Server', 'Signal', 'Video', 'Japan', 'Normal', 'Admin', 'Max', 'Min', 'Median', 'Minimal',
    'Redis', 'Passkey', 'Region', 'Region {region}', 'Bank: {bank}',
    'Aura Status', 'Aura Terminal', 'Aqua Frost', 'Neo Cyan', 'Violet Storm',
    'Hindi', 'Gujarati', 'Kannada', 'Malayalam', 'Marathi', 'Punjabi', 'Sanskrit', 'Telugu', 'Urdu',
  ]),
  pt: new Set(['Total', 'Menu', 'Item', 'Status', 'Original', 'Normal', 'Local', 'Control']),
};

const PROTECTED_ENTITY_TERMS = [
  'Aura Marketplace Desktop',
  'Aura Marketplace',
  'Trusted Device',
  'SECURITY_ADMIN',
  'SUPER_ADMIN',
  'DEACTIVATE',
  'Aura Points',
  'CloudFront',
  'Mission OS',
  'Turnstile',
  'Playwright',
  'Deal DNA',
  'WhatsApp',
  'Razorpay',
  'Firebase',
  'Microsoft',
  'Facebook',
  'LiveKit',
  'Whisper',
  'Netlify',
  'Vercel',
  'Render',
  'Stripe',
  'PayPal',
  'Gemini',
  'Google',
  'GitHub',
  'Apple',
  'Resend',
  'Gemma',
  'Aura',
  'Cost Explorer',
  'CloudWatch',
  'TOTP',
  'JSON',
  'HTML',
  'HTTP',
  'SMTP',
  'EC2',
  'SSM',
  'AWS',
  'OTP',
  'UPI',
  'KYC',
  'MFA',
  'SMS',
  'API',
  'URL',
  'PDF',
  'CSV',
  'SKU',
  'EMI',
  'COD',
  'FX',
  'AI',
  'UI',
  'QR',
  'ID',
];

const DETECTION_IGNORED_LATIN_TERMS = [
  'Snapdragon 8 Gen 3',
  'GitHub Actions',
  'LocalStack',
  'LambdaTest',
  'Ctrl/Cmd+Enter',
  'Shift+Enter',
  'Power BI',
  'Testmail',
  'Datadog',
  'Doppler',
  'Android',
  'Microsoft',
  'Facebook',
  'Snapdragon',
  'DEACTIVATE',
  'SECURITY_ADMIN',
  'SUPER_ADMIN',
  'Sentry',
  'GitHub',
  'Google',
  'Apple',
  'Gmail',
  'Gatus',
  'OAuth',
  'WebP',
  'WEBP',
  'JPEG',
  'Ctrl',
  'Cmd',
  'Shift',
  'Enter',
  'PNG',
  'JPG',
  'iOS',
  'X',
];

const STRICT_VERBATIM_LITERAL_RE = /^(?:https?:\/\/\S+|mailto:\S+|[^\s@]+@[^\s@]+\.[^\s@]+|npm\s+run\s+[a-z0-9:_-]+|[Nn]\/[Aa]|MM\s*\/\s*YY|Gmail|Gatus|Uptime Kuma|Aura Marketplace Desktop|Aura Marketplace \{\{?version\}\}?|\{\{?phoneCode\}\}?\s*98X+)$/;

const NON_TRANSLATABLE_EXACT_RE = /^(?:[\d\s.,:%+\-–—/|·•()#*_[\]{}]+|https?:\/\/\S+|mailto:\S+|[^\s@]+@[^\s@]+\.[^\s@]+|npm\s+run\s+[a-z0-9:_-]+|[Nn]\/[Aa]|MM\s*\/\s*YY|Gmail|Gatus|Uptime Kuma|Aura Marketplace Desktop|Aura Marketplace \{\{?version\}\}?|\{\{?phoneCode\}\}?\s*98X+|(?:[A-Z0-9_.-]{1,3}|[A-Z0-9]+_[A-Z0-9_]+))$/;

const FOOTER_CLEAN_BODY_NEW = 'Search, deals, marketplace browsing, and support stay connected across every storefront session.';

const escapeRegExp = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const loadGlossary = () => {
  const brandTermsPath = path.join(GLOSSARY_DIR, 'brand-terms.json');
  const forbiddenPath = path.join(GLOSSARY_DIR, 'forbidden-transliterations.json');
  const qaRulesPath = path.join(QUALITY_DIR, 'qaRules.json');
  const brands = fs.existsSync(brandTermsPath) ? JSON.parse(fs.readFileSync(brandTermsPath, 'utf8')) : {};
  const forbidden = fs.existsSync(forbiddenPath) ? JSON.parse(fs.readFileSync(forbiddenPath, 'utf8')) : {};
  const qaRules = fs.existsSync(qaRulesPath) ? JSON.parse(fs.readFileSync(qaRulesPath, 'utf8')) : {};
  return { brands, forbidden, qaRules };
};

const extractLeafOrStripVars = (value, isIcu = true) => {
  const raw = String(value || '');
  if (isIcu) {
    try {
      return extractIcuLeafTexts(parse(raw), []).join(' ');
    } catch {
      // Fall through to non-plural variable replacement on malformed ICU
    }
  }
  return raw
    .replace(/\{\{\s*[A-Za-z0-9_.]+\s*\}\}|\{\s*[A-Za-z0-9_.]+(?:\s*,\s*(?:number|date|time)[^}]*)?\}/g, ' ')
    .replace(/<[^>]+>|https?:\/\/\S+|mailto:\S+/g, ' ');
};

export const hasCorruptedQuestionMarks = (targetValue, sourceValue = '', isIcu = true) => {
  const cleanedTarget = extractLeafOrStripVars(targetValue, isIcu);
  const cleanedSource = extractLeafOrStripVars(sourceValue, isIcu);
  if (!QUESTION_MARK_CORRUPTION_RE.test(cleanedTarget)) {
    return false;
  }
  return !QUESTION_MARK_CORRUPTION_RE.test(cleanedSource);
};

export const hasMojibake = (value) => MOJIBAKE_RE.test(String(value || ''));

const stripNonProseTokens = (value) => {
  let out = String(value || '').replace(ICU_OR_LEGACY_VAR_RE, ' ');
  for (const term of PROTECTED_ENTITY_TERMS) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'g'), ' ');
  }
  for (const term of DETECTION_IGNORED_LATIN_TERMS) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'g'), ' ');
  }
  return out
    .replace(/\b(?:UPI|CARD|WALLET|NETBANKING|COD)(?:\/(?:UPI|CARD|WALLET|NETBANKING|COD))+\b/g, ' ')
    .replace(/\.[a-z0-9]{2,5}\b/gi, ' ')
    .replace(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const isNonTranslatableSource = (enText) => {
  const trimmed = String(enText || '').trim();
  if (!trimmed) return true;
  if (NON_TRANSLATABLE_EXACT_RE.test(trimmed)) return true;
  const stripped = stripNonProseTokens(trimmed);
  const letters = stripped.match(/\p{L}/gu) || [];
  if (letters.length <= 1) return true;
  // Pure short uppercase codes (e.g. "2G", "OK", "FAQ", "ID") — keep 4+ char UI words like "VERIFY" translatable
  if (!/\p{Ll}/u.test(stripped) && stripped.split(/\s+/).length === 1 && stripped.length <= 3) {
    return true;
  }
  return false;
};

const extractIcuLeafTexts = (astNodes = [], out = []) => {
  for (const node of astNodes) {
    if (node.type === TYPE.literal) {
      if (node.value) out.push(node.value);
    } else if (node.type === TYPE.plural || node.type === TYPE.select) {
      for (const option of Object.values(node.options || {})) {
        extractIcuLeafTexts(option.value || [], out);
      }
    } else if (node.type === TYPE.tag) {
      extractIcuLeafTexts(node.children || [], out);
    }
  }
  return out;
};

export const isRomanizedOrUntranslated = (locale, targetValue, enSource, isIcu = true) => {
  if (!targetValue || !String(targetValue).trim()) return true;
  if (isNonTranslatableSource(enSource)) return false;

  // Check exact match with English source
  const trimmedTarget = String(targetValue).trim();
  const trimmedSource = String(enSource).trim();
  if (trimmedTarget === trimmedSource) {
    if (EURO_GENUINE_COGNATES[locale]?.has(trimmedSource)) {
      return false;
    }
    return true;
  }

  // Check European ASCII-stripped stems
  const euroRe = ASCII_STRIPPED_EURO_PATTERNS[locale];
  if (euroRe) {
    const strippedTarget = String(targetValue).replace(ICU_OR_LEGACY_VAR_RE, ' ');
    if (euroRe.test(strippedTarget)) {
      return true;
    }
  }

  // Check non-Latin script leakage ONLY on literal prose leaves (not ICU syntax keywords!)
  const scriptPattern = NON_LATIN_SCRIPT_PATTERNS[locale];
  if (scriptPattern) {
    let literalText = '';
    if (isIcu) {
      try {
        const ast = parse(String(targetValue));
        literalText = extractIcuLeafTexts(ast, []).join(' ');
      } catch {
        literalText = String(targetValue).replace(ICU_OR_LEGACY_VAR_RE, ' ');
      }
    } else {
      literalText = String(targetValue).replace(ICU_OR_LEGACY_VAR_RE, ' ');
    }

    const residual = stripNonProseTokens(literalText);
    const totalLetters = (residual.match(/\p{L}/gu) || []).length;
    if (totalLetters >= 2) {
      const latinLetters = (residual.match(/[A-Za-z]/g) || []).length;
      scriptPattern.lastIndex = 0;
      const nativeLetters = (residual.match(scriptPattern) || []).length;
      if (nativeLetters === 0 || (latinLetters / totalLetters) > 0.38) {
        return true;
      }
    }
  }

  return false;
};

export const needsRepair = ({ key, locale, targetValue, enSource, isIcu = true }) => {
  const trimmedSource = String(enSource || '').trim();
  const trimmedTarget = String(targetValue || '').trim();
  if (
    key === 'footer.cleanBody'
    && /\b(?:clutter|noise|clean storefront|no clutter|without clutter|without noise)\b/i.test(trimmedTarget)
  ) {
    return 'stale-source';
  }
  if (!targetValue || typeof targetValue !== 'string' || !trimmedTarget) return 'missing';
  if (STRICT_VERBATIM_LITERAL_RE.test(trimmedSource) && trimmedTarget !== trimmedSource) {
    return 'verbatim-drift';
  }
  if (
    /\{\{\{|\u2047|\ufffd|\u2219\s*\u2219/u.test(targetValue)
    || (/\bVERIFY\b/.test(trimmedSource) && !/\bVERY\b/.test(trimmedSource) && /(?:बहुत ही|अत्यंत|बहुत अच्छा|बहुत सही|खूब|非常|とても|बहुत खास|ख़ास)/i.test(trimmedTarget))
    || (key === 'nav.tuneMarket' && /tune market|म्यूनिख|टुन|ट्यून|मटेरियल|ٹون|ٹیون|ટ્યુન|ਟਿਊਨ|ട്യൂൺ|ಟ್ಯೂನ್|ମ୍ୟୁନିସିପାଲ|ଟ୍ୟୁନ୍|মুন|টুন|সুর|सुर|धुन|मत्स्य|لحن|tonnes|سوق المياه|チューン|鱼市场|tunfisch|thunfisch|atún|atum|ماهی|टन|ٹونا|ட்யூன்|ట్యూన్|ಟೂನ್/i.test(targetValue))
  ) {
    return 'corrupt-token';
  }
  if (hasMojibake(targetValue)) return 'mojibake';
  if (hasCorruptedQuestionMarks(targetValue, enSource, isIcu)) return 'question-corruption';
  if (locale === 'zh' && /[\u4E00-\u9FFF][ \t]+[\u4E00-\u9FFF]/.test(trimmedTarget)) {
    return 'zh-unk-space';
  }
  if (trimmedSource === 'Aura points' && /^Aura Points?$/i.test(trimmedTarget)) {
    return 'stale-brand-case';
  }
  if (key === 'payment.jsx.text.req' && /^(?:Req:|प्रश्नः|प्रच्छदঃ|প্রচ্ছদঃ)$/.test(trimmedTarget)) {
    return 'disambiguation-repair';
  }
  if (isIcu) {
    try {
      const enAst = parse(String(enSource));
      const trAst = parse(String(targetValue));
      const eq = isStructurallySame(enAst, trAst);
      if (!eq.success) return 'icu-structure';
    } catch {
      return 'icu-parse';
    }
  }
  if (isRomanizedOrUntranslated(locale, targetValue, enSource, isIcu)) {
    return 'romanized-or-untranslated';
  }
  return null;
};

/**
 * Mask a literal/mixed text segment with sequential `{v0}`, `{v1}` sentinels
 * covering protected entities and placeholders (or legacy `{{var}}` expressions).
 */
export const maskSegment = (rawSegment, placeholders = []) => {
  const tokenMap = [];
  const text = String(rawSegment || '');
  const brandAlternation = PROTECTED_ENTITY_TERMS.map(escapeRegExp).join('|');
  const combinedRe = new RegExp(
    `(__AST_TOK_(\\d+)__)|(\\{\\{[^{}]+\\}\\}|\\{[^{}]+\\})|(https?:\\/\\/\\S+|mailto:\\S+)|\\b(${brandAlternation})\\b`,
    'g'
  );

  const maskedText = text.replace(combinedRe, (full, astFull, astIdxStr, varMatch, urlMatch, brandMatch) => {
    const token = `{v${tokenMap.length}}`;
    if (astFull) {
      tokenMap.push({ sentinel: token, replacement: placeholders[Number(astIdxStr)] });
    } else {
      tokenMap.push({ sentinel: token, replacement: varMatch || urlMatch || brandMatch || full });
    }
    return token;
  });

  return { maskedText, tokenMap };
};

export const restoreSegment = (translatedMaskedText, tokenMap, fallbackSource = '') => {
  let out = String(translatedMaskedText || '').trim();
  if (!out) return fallbackSource;

  // Verify all sentinels `{vK}` exist 1:1; recover gracefully if spacing altered
  for (let i = 0; i < tokenMap.length; i += 1) {
    const { sentinel, replacement } = tokenMap[i];
    // Handle optional extra spaces inside or stripped braces from aggressive decoding
    const looseRe = new RegExp(`\\{\\s*v\\s*${i}\\s*\\}|_${i}_`, 'g');
    if (out.includes(sentinel)) {
      out = out.split(sentinel).join(replacement);
    } else if (looseRe.test(out)) {
      out = out.replace(looseRe, replacement);
    } else {
      // If a sentinel was genuinely dropped, fail signal so Pass 2 fallback or safe restore triggers
      return null;
    }
  }

  // Clean accidental duplicate spacing around inline placeholders
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out;
};

/**
 * Extract contiguous AST leaf sequences (`(literal|argument|number|date|time|pound)*`)
 * inside every plural/select branch and tag wrapper while preserving outer ICU AST structure.
 */
const serializeAstNodesToSegments = (astNodes = [], segmentsOut = []) => {
  const templateParts = [];
  let bufferText = '';
  const bufferTokens = [];

  const flushBuffer = () => {
    if (!bufferText && bufferTokens.length === 0) return;
    if (isNonTranslatableSource(bufferText.replace(/__AST_TOK_\d+__/g, ''))) {
      // Emit verbatim without translating
      const literal = bufferText.replace(/__AST_TOK_(\d+)__/g, (_, i) => bufferTokens[Number(i)]);
      templateParts.push({ kind: 'verbatim', value: literal });
    } else {
      const { maskedText, tokenMap } = maskSegment(bufferText, bufferTokens);
      if (isNonTranslatableSource(maskedText.replace(/\{v\d+\}/g, ''))) {
        templateParts.push({ kind: 'verbatim', value: restoreSegment(maskedText, tokenMap, bufferText) });
      } else {
        const segIdx = segmentsOut.length;
        segmentsOut.push({ maskedText, tokenMap, rawSource: bufferText });
        templateParts.push({ kind: 'segment', segIdx, tokenMap, rawSource: bufferText });
      }
    }
    bufferText = '';
    bufferTokens.length = 0;
  };

  for (const node of astNodes) {
    if (node.type === TYPE.literal) {
      bufferText += node.value;
    } else if (node.type === TYPE.argument) {
      bufferText += `__AST_TOK_${bufferTokens.length}__`;
      bufferTokens.push(`{${node.value}}`);
    } else if (node.type === TYPE.pound) {
      bufferText += `__AST_TOK_${bufferTokens.length}__`;
      bufferTokens.push('#');
    } else if (node.type === TYPE.number) {
      const stylePart = node.style ? `, ${formatIcuStyle(node.style)}` : '';
      bufferText += `__AST_TOK_${bufferTokens.length}__`;
      bufferTokens.push(`{${node.value}, number${stylePart}}`);
    } else if (node.type === TYPE.date || node.type === TYPE.time) {
      const typeName = node.type === TYPE.date ? 'date' : 'time';
      const stylePart = node.style ? `, ${node.style}` : '';
      bufferText += `__AST_TOK_${bufferTokens.length}__`;
      bufferTokens.push(`{${node.value}, ${typeName}${stylePart}}`);
    } else if (node.type === TYPE.plural || node.type === TYPE.select) {
      flushBuffer();
      const icuKind = node.type === TYPE.plural
        ? (node.pluralType === 'ordinal' ? 'selectordinal' : 'plural')
        : 'select';
      const offsetStr = node.offset ? ` offset:${node.offset}` : '';
      const branches = {};
      for (const [optKey, optVal] of Object.entries(node.options || {})) {
        branches[optKey] = serializeAstNodesToSegments(optVal.value || [], segmentsOut);
      }
      templateParts.push({ kind: 'icuBlock', varName: node.value, icuKind, offsetStr, branches });
    } else if (node.type === TYPE.tag) {
      flushBuffer();
      templateParts.push({
        kind: 'tag',
        tagName: node.value,
        childrenTemplate: serializeAstNodesToSegments(node.children || [], segmentsOut),
      });
    }
  }
  flushBuffer();
  return templateParts;
};

const formatIcuStyle = (style) => {
  if (!style) return '';
  if (typeof style === 'string') return style;
  if (style.pattern) return `::${style.pattern}`;
  return '';
};

const renderTemplateParts = (parts, resolvedSegmentTexts) => parts.map((part) => {
  if (part.kind === 'verbatim') return part.value;
  if (part.kind === 'segment') {
    const translated = resolvedSegmentTexts[part.segIdx];
    const restored = translated ? restoreSegment(translated, part.tokenMap, '') : null;
    if (restored === null) {
      // Preserve clean fallback without losing variables
      return part.rawSource.replace(/__AST_TOK_(\d+)__/g, (_, idx) => part.tokenMap[Number(idx)]?.replacement || '');
    }
    return restored;
  }
  if (part.kind === 'tag') {
    return `<${part.tagName}>${renderTemplateParts(part.childrenTemplate, resolvedSegmentTexts)}</${part.tagName}>`;
  }
  if (part.kind === 'icuBlock') {
    const branchText = Object.entries(part.branches)
      .map(([optKey, branchParts]) => `${optKey} {${renderTemplateParts(branchParts, resolvedSegmentTexts)}}`)
      .join(' ');
    return `{${part.varName}, ${part.icuKind}${part.offsetStr}, ${branchText}}`;
  }
  return '';
}).join('');

export const decomposeMessage = (enSource, isIcu = true) => {
  if (isIcu) {
    try {
      const ast = parse(String(enSource));
      const segments = [];
      const template = serializeAstNodesToSegments(ast, segments);
      return { template, segments, isAst: true };
    } catch {
      // Fallback to flat masking if source wasn't valid AST
    }
  }
  const { maskedText, tokenMap } = maskSegment(String(enSource || ''));
  return {
    isAst: false,
    segments: isNonTranslatableSource(maskedText.replace(/\{v\d+\}/g, ''))
      ? []
      : [{ maskedText, tokenMap, rawSource: String(enSource || '') }],
    tokenMap,
  };
};

export const reassembleMessage = (decomposed, translatedSegmentsMap, locale, enSource, isIcu = true) => {
  let candidate = '';
  if (decomposed.isAst) {
    const resolved = decomposed.segments.map((seg) => translatedSegmentsMap.get(`${locale}\u0000${seg.maskedText}`) || '');
    candidate = renderTemplateParts(decomposed.template, resolved);
  } else if (decomposed.segments.length === 0) {
    candidate = String(enSource || '');
  } else {
    const seg = decomposed.segments[0];
    const translated = translatedSegmentsMap.get(`${locale}\u0000${seg.maskedText}`) || '';
    const restored = translated ? restoreSegment(translated, seg.tokenMap, '') : null;
    candidate = restored ?? String(enSource || '');
  }

  // Enforce protected brand invariants against accidental transliteration
  const { forbidden } = loadGlossary();
  for (const [brand, badForms] of Object.entries(forbidden || {})) {
    for (const bad of badForms || []) {
      if (candidate.includes(bad)) {
        candidate = candidate.split(bad).join(brand);
      }
    }
  }

  // Validate ICU structure before accepting
  if (isIcu) {
    try {
      const enAst = parse(String(enSource));
      const trAst = parse(candidate);
      if (!isStructurallySame(enAst, trAst).success) {
        return String(enSource || '');
      }
    } catch {
      return String(enSource || '');
    }
  }

  return candidate;
};

const loadConfigSources = async () => {
  const { MARKET_MESSAGES } = await import('../../app/src/config/marketConfig.js');
  const { GENERATED_MARKET_MESSAGES } = await import('../../app/src/config/generatedMarketMessages.js');
  const { REMAINING_UI_LOCALE_MESSAGES } = await import('../../app/src/config/remainingUiLocaleMessages.js');
  const { LOCALE_POLISH_MESSAGES } = await import('../../app/src/config/localePolishMessages.js');
  return { MARKET_MESSAGES, GENERATED_MARKET_MESSAGES, REMAINING_UI_LOCALE_MESSAGES, LOCALE_POLISH_MESSAGES };
};

const extractSimpleOverridesBlockKeys = () => {
  const mcSource = fs.readFileSync(path.join(CONFIG_DIR, 'marketConfig.js'), 'utf8');
  const startMarker = 'const SIMPLE_OVERRIDES = {';
  const endMarker = '\n};\n\nconst NON_ENGLISH_RUNTIME_MESSAGE_BACKFILL =';
  const startIdx = mcSource.indexOf(startMarker);
  const endIdx = mcSource.indexOf(endMarker, startIdx);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error('Could not locate SIMPLE_OVERRIDES block in marketConfig.js');
  }
  const blockBody = mcSource.slice(startIdx + startMarker.length - 1, endIdx + 2);
  // Safe static literal eval inside Function (no I/O)
  const simpleOverrides = new Function(`return (${blockBody.replace(/;$/, '')});`)();
  return { mcSource, startIdx, endIdx, simpleOverrides };
};

const collectAllRepairTasks = async () => {
  const enReviewed = JSON.parse(fs.readFileSync(path.join(REVIEWED_DIR, 'en.json'), 'utf8'));
  const enReviewedUpdated = { ...enReviewed, 'footer.cleanBody': FOOTER_CLEAN_BODY_NEW };

  const {
    MARKET_MESSAGES,
    GENERATED_MARKET_MESSAGES,
    REMAINING_UI_LOCALE_MESSAGES,
    LOCALE_POLISH_MESSAGES,
  } = await loadConfigSources();
  const enGenerated = { ...(GENERATED_MARKET_MESSAGES.en || {}), 'footer.cleanBody': FOOTER_CLEAN_BODY_NEW };
  const enRemaining = { ...(REMAINING_UI_LOCALE_MESSAGES.en || {}) };
  const { simpleOverrides } = extractSimpleOverridesBlockKeys();

  // Master English lookup across all config layers (including MARKET_MESSAGES.en & legacy phoneHint.signin)
  const masterEn = {
    'login.phoneHint.signin': 'Signing in sends one code to email and one Firebase SMS code to your phone.',
    ...(MARKET_MESSAGES.en || {}),
    ...enGenerated,
    ...enRemaining,
    ...enReviewedUpdated,
  };

  const uniqueSegmentTasks = new Map(); // `${locale}\u0000${maskedText}` -> { locale, floresCode, maskedText }
  const cleanSegmentSeeds = new Map(); // `${locale}\u0000${maskedText}` -> clean translated masked segment from reviewed catalogs
  const stats = {
    reviewed: {},
    simpleOverrides: {},
    remainingUi: {},
    localePolish: {},
    generated: {},
    reusedCleanSegments: 0,
  };

  const tryExtractCleanSeed = (locale, enVal, trVal) => {
    const decomposed = decomposeMessage(enVal, true);
    if (!decomposed.isAst || decomposed.segments.length !== 1 || decomposed.template.length !== 1 || decomposed.template[0].kind !== 'segment') {
      return;
    }
    const seg = decomposed.segments[0];
    const seedKey = `${locale}\u0000${seg.maskedText}`;
    if (cleanSegmentSeeds.has(seedKey)) return;

    let maskedTr = String(trVal || '').trim();
    if (!maskedTr) return;
    for (const entry of seg.tokenMap) {
      const first = maskedTr.indexOf(entry.replacement);
      if (first < 0 || maskedTr.indexOf(entry.replacement, first + 1) >= 0) {
        return;
      }
      maskedTr = maskedTr.slice(0, first) + entry.sentinel + maskedTr.slice(first + entry.replacement.length);
    }
    if (restoreSegment(maskedTr, seg.tokenMap, '') === null) {
      return;
    }
    cleanSegmentSeeds.set(seedKey, maskedTr);
  };

  const registerTask = (locale, decomposed) => {
    const floresCode = FLORES_LOCALE_MAP[locale];
    for (const seg of decomposed.segments) {
      const id = `${locale}\u0000${seg.maskedText}`;
      if (cleanSegmentSeeds.has(id)) {
        stats.reusedCleanSegments += 1;
        continue;
      }
      if (!uniqueSegmentTasks.has(id)) {
        uniqueSegmentTasks.set(id, { id, locale, floresCode, maskedText: seg.maskedText });
      }
    }
  };

  const normalizeLegacyToIcu = (val) => String(val || '').replace(/\{\{(\w+)\}\}/g, '{$1}');
  const convertSimpleIcuToLegacy = (val) => String(val || '')
    .replace(/\{(\w+),\s*number\}/g, '{{$1}}')
    .replace(/\{(\w+)\}/g, '{{$1}}');

  for (const locale of TARGET_LOCALES) {
    // 1. Reviewed ICU catalogs
    const revPath = path.join(REVIEWED_DIR, `${locale}.json`);
    const revData = JSON.parse(fs.readFileSync(revPath, 'utf8'));
    const validReviewedLegacyMap = new Map();
    const pendingReviewedForLocale = [];
    let revRepairCount = 0;
    // Pass 1a: index all verified clean reviewed entries first so sibling keys with identical English text reuse them immediately
    for (const [key, enVal] of Object.entries(enReviewedUpdated)) {
      const reason = needsRepair({ key, locale, targetValue: revData[key], enSource: enVal, isIcu: true });
      if (reason) {
        revRepairCount += 1;
        pendingReviewedForLocale.push(enVal);
      } else {
        tryExtractCleanSeed(locale, enVal, revData[key]);
        if (!/\{[^,{}]+,\s*(?:plural|select|selectordinal)/.test(revData[key])) {
          validReviewedLegacyMap.set(key, {
            enNorm: enVal,
            legacyTarget: convertSimpleIcuToLegacy(revData[key]),
          });
        }
      }
    }
    for (const enVal of pendingReviewedForLocale) {
      registerTask(locale, decomposeMessage(enVal, true));
    }
    stats.reviewed[locale] = revRepairCount;

    const canReuseCleanReviewed = (key, enLegacyVal) => {
      const entry = validReviewedLegacyMap.get(key);
      if (!entry) return false;
      return entry.enNorm === enLegacyVal || entry.enNorm === normalizeLegacyToIcu(enLegacyVal);
    };

    // 2. SIMPLE_OVERRIDES in marketConfig.js
    const soMap = simpleOverrides[locale] || {};
    let soCount = 0;
    for (const [key, val] of Object.entries(soMap)) {
      const enVal = masterEn[key];
      if (!enVal) continue;
      if (needsRepair({ key, locale, targetValue: val, enSource: enVal, isIcu: false })) {
        soCount += 1;
        if (!canReuseCleanReviewed(key, enVal)) {
          registerTask(locale, decomposeMessage(enVal, false));
        }
      }
    }
    stats.simpleOverrides[locale] = soCount;

    // 3. LOCALE_POLISH_MESSAGES
    const lpMap = LOCALE_POLISH_MESSAGES[locale] || {};
    let lpCount = 0;
    for (const [key, val] of Object.entries(lpMap)) {
      const enVal = masterEn[key];
      if (!enVal) continue;
      if (needsRepair({ key, locale, targetValue: val, enSource: enVal, isIcu: false })) {
        lpCount += 1;
        if (!canReuseCleanReviewed(key, enVal)) {
          registerTask(locale, decomposeMessage(enVal, false));
        }
      }
    }
    stats.localePolish[locale] = lpCount;

    // 4. REMAINING_UI_LOCALE_MESSAGES
    const remMap = REMAINING_UI_LOCALE_MESSAGES[locale] || {};
    let remCount = 0;
    for (const [key, val] of Object.entries(remMap)) {
      const enVal = enRemaining[key] || masterEn[key];
      if (!enVal) continue;
      if (needsRepair({ key, locale, targetValue: val, enSource: enVal, isIcu: false })) {
        remCount += 1;
        if (!canReuseCleanReviewed(key, enVal)) {
          registerTask(locale, decomposeMessage(enVal, false));
        }
      }
    }
    stats.remainingUi[locale] = remCount;

    // 5. GENERATED_MARKET_MESSAGES
    const genMap = GENERATED_MARKET_MESSAGES[locale] || {};
    let genCount = 0;
    for (const [key, enVal] of Object.entries(enGenerated)) {
      if (needsRepair({ key, locale, targetValue: genMap[key], enSource: enVal, isIcu: false })) {
        genCount += 1;
        if (!canReuseCleanReviewed(key, enVal)) {
          registerTask(locale, decomposeMessage(enVal, false));
        }
      }
    }
    stats.generated[locale] = genCount;
  }

  return {
    enReviewedUpdated,
    enGenerated,
    masterEn,
    simpleOverrides,
    cleanSegmentSeeds,
    uniqueSegmentTasks,
    stats,
  };
};

const escapeJsString = (value) => JSON.stringify(String(value));

const formatJsObjectEntries = (obj, indent = '  ') => Object.entries(obj)
  .map(([k, v]) => `${indent}${JSON.stringify(k)}: ${escapeJsString(v)},`)
  .join('\n');

const writeLocalePolishMessages = (updatedMap) => {
  const lines = [
    '// Curated native UTF-8 locale overrides across storefronts.',
    '// Maintained by scripts/i18n/icu-ast-repair-engine.mjs — zero Romanized or ASCII-stripped strings.',
    'export const LOCALE_POLISH_MESSAGES = {};',
    '',
  ];
  for (const [locale, map] of Object.entries(updatedMap)) {
    lines.push(`LOCALE_POLISH_MESSAGES.${locale} = {`);
    lines.push(formatJsObjectEntries(map, '  '));
    lines.push('};');
    lines.push('');
  }
  lines.push('export default LOCALE_POLISH_MESSAGES;');
  lines.push('');
  fs.writeFileSync(path.join(CONFIG_DIR, 'localePolishMessages.js'), lines.join('\n'), 'utf8');
};

const writeRemainingUiLocaleMessages = (originalSource, updatedAllMap, enBase) => {
  // Preserve EN_REMAINING_UI_MESSAGES and LEGACY_MARKET_PACK_COVERAGE_MESSAGES verbatim up to export const REMAINING_UI_LOCALE_MESSAGES
  const exportIdx = originalSource.indexOf('export const REMAINING_UI_LOCALE_MESSAGES = {');
  if (exportIdx < 0) {
    throw new Error('Could not locate export const REMAINING_UI_LOCALE_MESSAGES in remainingUiLocaleMessages.js');
  }
  const header = originalSource.slice(0, exportIdx);
  const lines = [
    header.trimEnd(),
    '',
    'export const REMAINING_UI_LOCALE_MESSAGES = {',
    '  en: EN_REMAINING_UI_MESSAGES,',
  ];
  for (const locale of TARGET_LOCALES) {
    const locMap = updatedAllMap[locale] || {};
    const overrides = {};
    const isFullLocaleBuilder = (locale === 'hi' || locale === 'es' || locale === 'fr' || locale === 'de' || locale === 'ar' || locale === 'ja' || locale === 'pt' || locale === 'zh');
    // Both builders fall back to English EN_REMAINING_UI_MESSAGES / LEGACY_MARKET_PACK_COVERAGE_MESSAGES at runtime;
    // diffing against enBase preserves every translated override across idempotent runs.
    for (const [k, v] of Object.entries(locMap)) {
      if (v !== enBase[k]) {
        overrides[k] = v;
      }
    }
    const helper = isFullLocaleBuilder ? 'buildLocaleMessages' : 'buildLegacyCoverageMessages';
    lines.push(`  ${locale}: ${helper}({`);
    lines.push(formatJsObjectEntries(overrides, '    '));
    lines.push('  }),');
  }
  lines.push('};');
  lines.push('');
  fs.writeFileSync(path.join(CONFIG_DIR, 'remainingUiLocaleMessages.js'), lines.join('\n'), 'utf8');
};

const writeSimpleOverridesInMarketConfig = (mcSource, startIdx, endIdx, updatedSimpleOverrides) => {
  const before = mcSource.slice(0, startIdx);
  const after = mcSource.slice(endIdx);
  const lines = ['const SIMPLE_OVERRIDES = {'];
  for (const [locale, map] of Object.entries(updatedSimpleOverrides)) {
    lines.push(`  ${locale}: {`);
    lines.push(formatJsObjectEntries(map, '    '));
    lines.push('  },');
  }
  lines.push('};');
  const tail = after.replace(/^(?:\r?\n)?\};+/, '');
  const nextSource = `${before}${lines.join('\n')}${tail}`;
  fs.writeFileSync(path.join(CONFIG_DIR, 'marketConfig.js'), nextSource, 'utf8');
};

const applyTranslations = async (translationsPath) => {
  const {
    enReviewedUpdated,
    enGenerated,
    masterEn,
    simpleOverrides,
    cleanSegmentSeeds,
  } = await collectAllRepairTasks();

  const rawResults = JSON.parse(fs.readFileSync(translationsPath, 'utf8'));
  const translatedSegmentsMap = new Map(cleanSegmentSeeds);
  for (const item of rawResults) {
    if (!translatedSegmentsMap.has(item.id) || item.translatedText) {
      translatedSegmentsMap.set(item.id, item.translatedText);
    }
  }
  const { GENERATED_MARKET_MESSAGES, REMAINING_UI_LOCALE_MESSAGES, LOCALE_POLISH_MESSAGES } = await loadConfigSources();

  // Fix en.json footer.cleanBody first
  fs.writeFileSync(
    path.join(REVIEWED_DIR, 'en.json'),
    `${JSON.stringify(enReviewedUpdated, null, 2)}\n`,
    'utf8',
  );

  // 1. Update reviewed/<locale>.json for all 19 locales & capture repaired reviewed lookup
  const repairedReviewedByLocale = {};
  const repairedCounts = { reviewed: 0, polish: 0, remaining: 0, simpleOverrides: 0, generated: 0 };
  for (const locale of TARGET_LOCALES) {
    const revPath = path.join(REVIEWED_DIR, `${locale}.json`);
    const revData = JSON.parse(fs.readFileSync(revPath, 'utf8'));
    const nextRev = {};
    for (const key of Object.keys(enReviewedUpdated)) {
      const enVal = enReviewedUpdated[key];
      const existing = revData[key];
      const reason = needsRepair({ key, locale, targetValue: existing, enSource: enVal, isIcu: true });
      if (reason) {
        const decomposed = decomposeMessage(enVal, true);
        const fixed = reassembleMessage(decomposed, translatedSegmentsMap, locale, enVal, true);
        nextRev[key] = fixed;
        repairedCounts.reviewed += 1;
      } else {
        nextRev[key] = existing;
      }
    }
    repairedReviewedByLocale[locale] = nextRev;
    fs.writeFileSync(revPath, `${JSON.stringify(nextRev, null, 2)}\n`, 'utf8');
  }

  const convertReviewedForLegacy = (locale, key, legacyEnVal) => {
    const revTarget = repairedReviewedByLocale[locale]?.[key];
    const revEn = enReviewedUpdated[key];
    if (!revTarget || !revEn) return null;
    if (/\{[^,{}]+,\s*(?:plural|select|selectordinal)/.test(revTarget)) return null;
    const normLegacyEn = String(legacyEnVal || '').replace(/\{\{(\w+)\}\}/g, '{$1}');
    if (normLegacyEn !== revEn && legacyEnVal !== revEn) return null;
    return revTarget.replace(/\{(\w+),\s*number\}/g, '{{$1}}').replace(/\{(\w+)\}/g, '{{$1}}');
  };

  // 2. Update SIMPLE_OVERRIDES inside marketConfig.js
  const { mcSource, startIdx, endIdx } = extractSimpleOverridesBlockKeys();
  const nextSimpleOverrides = {};
  for (const [locale, map] of Object.entries(simpleOverrides)) {
    nextSimpleOverrides[locale] = {};
    for (const [key, val] of Object.entries(map || {})) {
      const enVal = masterEn[key];
      if (enVal && needsRepair({ key, locale, targetValue: val, enSource: enVal, isIcu: false })) {
        const fromReviewed = convertReviewedForLegacy(locale, key, enVal);
        if (fromReviewed) {
          nextSimpleOverrides[locale][key] = fromReviewed;
        } else {
          const normalizedEn = enVal.replace(/(?<!\{)\{(\w+)(?:,\s*number)?\}(?!\})/g, '{{$1}}');
          nextSimpleOverrides[locale][key] = reassembleMessage(decomposeMessage(normalizedEn, false), translatedSegmentsMap, locale, normalizedEn, false);
        }
        repairedCounts.simpleOverrides += 1;
      } else {
        nextSimpleOverrides[locale][key] = val;
      }
    }
  }
  writeSimpleOverridesInMarketConfig(mcSource, startIdx, endIdx, nextSimpleOverrides);

  // 3. Update LOCALE_POLISH_MESSAGES cleanly
  const nextPolish = {};
  for (const locale of TARGET_LOCALES) {
    const lpMap = LOCALE_POLISH_MESSAGES[locale] || {};
    if (Object.keys(lpMap).length === 0) continue;
    nextPolish[locale] = {};
    for (const [key, val] of Object.entries(lpMap)) {
      const enVal = masterEn[key];
      if (enVal && needsRepair({ key, locale, targetValue: val, enSource: enVal, isIcu: false })) {
        const fromReviewed = convertReviewedForLegacy(locale, key, enVal);
        if (fromReviewed) {
          nextPolish[locale][key] = fromReviewed;
        } else {
          const normalizedEn = enVal.replace(/(?<!\{)\{(\w+)(?:,\s*number)?\}(?!\})/g, '{{$1}}');
          nextPolish[locale][key] = reassembleMessage(decomposeMessage(normalizedEn, false), translatedSegmentsMap, locale, normalizedEn, false);
        }
        repairedCounts.polish += 1;
      } else {
        nextPolish[locale][key] = val;
      }
    }
  }
  writeLocalePolishMessages(nextPolish);

  // 4. Update REMAINING_UI_LOCALE_MESSAGES cleanly
  const remainingSource = fs.readFileSync(path.join(CONFIG_DIR, 'remainingUiLocaleMessages.js'), 'utf8');
  const enBase = REMAINING_UI_LOCALE_MESSAGES.en || {};
  const nextRemaining = { en: enBase };
  for (const locale of TARGET_LOCALES) {
    const remMap = REMAINING_UI_LOCALE_MESSAGES[locale] || {};
    nextRemaining[locale] = {};
    for (const [key, val] of Object.entries(remMap)) {
      const enVal = enBase[key] || masterEn[key];
      if (enVal && needsRepair({ key, locale, targetValue: val, enSource: enVal, isIcu: false })) {
        const fromReviewed = convertReviewedForLegacy(locale, key, enVal);
        if (fromReviewed) {
          nextRemaining[locale][key] = fromReviewed;
        } else {
          const normalizedEn = enVal.replace(/(?<!\{)\{(\w+)(?:,\s*number)?\}(?!\})/g, '{{$1}}');
          nextRemaining[locale][key] = reassembleMessage(decomposeMessage(normalizedEn, false), translatedSegmentsMap, locale, normalizedEn, false);
        }
        repairedCounts.remaining += 1;
      } else {
        nextRemaining[locale][key] = val;
      }
    }
  }
  writeRemainingUiLocaleMessages(remainingSource, nextRemaining, enBase);

  // 5. Update GENERATED_MARKET_MESSAGES cleanly
  const nextGenerated = { en: enGenerated };
  for (const locale of TARGET_LOCALES) {
    const genMap = GENERATED_MARKET_MESSAGES[locale] || {};
    nextGenerated[locale] = {};
    for (const key of Object.keys(enGenerated)) {
      const enVal = enGenerated[key];
      const existing = genMap[key];
      if (needsRepair({ key, locale, targetValue: existing, enSource: enVal, isIcu: false })) {
        const fromReviewed = convertReviewedForLegacy(locale, key, enVal);
        if (fromReviewed) {
          nextGenerated[locale][key] = fromReviewed;
        } else {
          nextGenerated[locale][key] = reassembleMessage(decomposeMessage(enVal, false), translatedSegmentsMap, locale, enVal, false);
        }
        repairedCounts.generated += 1;
      } else {
        nextGenerated[locale][key] = existing;
      }
    }
  }
  const genOut = `// Generated by scripts/generate_market_messages.mjs & repaired by icu-ast-repair-engine.mjs.\nexport const GENERATED_MARKET_MESSAGES = ${JSON.stringify(nextGenerated, null, 2)};\nexport default GENERATED_MARKET_MESSAGES;\n`;
  fs.writeFileSync(path.join(CONFIG_DIR, 'generatedMarketMessages.js'), genOut, 'utf8');

  console.log('Repaired entries applied:', repairedCounts);
};

const runCli = async () => {
  const args = process.argv.slice(2);
  if (args.includes('--extract')) {
    const outIdx = args.indexOf('--extract');
    const outPath = args[outIdx + 1];
    if (!outPath) throw new Error('Missing output path for --extract');
    const { uniqueSegmentTasks, stats } = await collectAllRepairTasks();
    const list = [...uniqueSegmentTasks.values()];
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify({ totalUniqueSegments: list.length, stats, tasks: list }, null, 2), 'utf8');
    console.log(`Extracted ${list.length} unique (locale, maskedSegment) repair tasks -> ${outPath}`);
    console.log('Breakdown by reviewed count:', stats.reviewed);
    return;
  }

  if (args.includes('--apply')) {
    const inIdx = args.indexOf('--apply');
    const inPath = args[inIdx + 1];
    if (!inPath) throw new Error('Missing input path for --apply');
    await applyTranslations(inPath);
    return;
  }

  // Default: --inspect
  const { uniqueSegmentTasks, stats } = await collectAllRepairTasks();
  console.log('Total unique (locale, maskedSegment) repair tasks:', uniqueSegmentTasks.size);
  console.log('Reviewed repair counts:', stats.reviewed);
  console.log('SimpleOverrides repair counts:', stats.simpleOverrides);
  console.log('LocalePolish repair counts:', stats.localePolish);
  console.log('RemainingUI repair counts:', stats.remainingUi);
  console.log('Generated repair counts:', stats.generated);
};

const isDirectExecution = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isDirectExecution) {
  runCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
