import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FIREBASE_WEB_CONFIG_KEYS = [
  'VITE_FIREBASE_CONFIG',
  'VITE_FIREBASE_WEB_CONFIG',
];

const FIREBASE_CONFIG_KEY_MAP = {
  VITE_FIREBASE_API_KEY: 'apiKey',
  VITE_FIREBASE_AUTH_DOMAIN: 'authDomain',
  VITE_FIREBASE_PROJECT_ID: 'projectId',
  VITE_FIREBASE_STORAGE_BUCKET: 'storageBucket',
  VITE_FIREBASE_MESSAGING_SENDER_ID: 'messagingSenderId',
  VITE_FIREBASE_APP_ID: 'appId',
  VITE_FIREBASE_MEASUREMENT_ID: 'measurementId',
};

const REQUIRED_FIREBASE_WEB_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
];

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const unquote = (value = '') => {
  const trimmed = String(value || '').trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const readEnvFile = (filePath) => {
  if (!existsSync(filePath)) return {};

  const env = {};
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    env[match[1]] = unquote(match[2]);
  }
  return env;
};

const loadViteEnv = () => {
  const mode = String(process.env.MODE || process.env.VITE_MODE || 'production').trim() || 'production';
  const files = [
    '.env',
    '.env.local',
    `.env.${mode}`,
    `.env.${mode}.local`,
  ];

  return files.reduce((env, fileName) => ({
    ...env,
    ...readEnvFile(path.join(appRoot, fileName)),
  }), {});
};

const env = {
  ...loadViteEnv(),
  ...process.env,
};

const sanitizeEnvValue = (value) => String(value || '')
  .replace(/\\[rnt]/g, '')
  .replace(/[\r\n\t]+/g, '')
  .trim();

const parseFirebaseConfigEnv = (value) => {
  const sanitized = sanitizeEnvValue(value);
  if (!sanitized) return {};

  try {
    const parsed = JSON.parse(sanitized);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const deriveDefaultAuthDomain = (projectId) => {
  const sanitizedProjectId = sanitizeEnvValue(projectId);
  if (!sanitizedProjectId || !/^[a-z0-9-]+$/i.test(sanitizedProjectId)) return '';
  return `${sanitizedProjectId}.firebaseapp.com`;
};

const aggregateFirebaseConfig = FIREBASE_WEB_CONFIG_KEYS.reduce((config, key) => ({
  ...config,
  ...parseFirebaseConfigEnv(env[key]),
}), {});

const effectiveEnv = Object.entries(FIREBASE_CONFIG_KEY_MAP).reduce((result, [envKey, configKey]) => {
  const directValue = sanitizeEnvValue(result[envKey]);
  result[envKey] = directValue || sanitizeEnvValue(aggregateFirebaseConfig[configKey]);
  return result;
}, { ...env });

if (!effectiveEnv.VITE_FIREBASE_AUTH_DOMAIN) {
  effectiveEnv.VITE_FIREBASE_AUTH_DOMAIN = deriveDefaultAuthDomain(effectiveEnv.VITE_FIREBASE_PROJECT_ID);
}

const normalizedDeployTarget = String(env.VITE_DEPLOY_TARGET || env.DEPLOY_TARGET || '')
  .trim()
  .toLowerCase();

const isStrictReleaseBuild = parseBoolean(env.AURA_VALIDATE_FRONTEND_AUTH_ENV, false)
  || env.VERCEL === '1'
  || String(env.NETLIFY || '').toLowerCase() === 'true'
  || ['aws', 'cloudfront', 'desktop', 'multi-host', 'netlify', 'production', 'vercel'].includes(normalizedDeployTarget);

if (parseBoolean(env.AURA_SKIP_FRONTEND_AUTH_ENV_VALIDATION, false) || !isStrictReleaseBuild) {
  process.exit(0);
}

const getValue = (key) => sanitizeEnvValue(effectiveEnv[key]);

const missingKeys = REQUIRED_FIREBASE_WEB_KEYS.filter((key) => !getValue(key));

const placeholderPatterns = [
  /^example$/i,
  /^example-project$/i,
  /^your-/i,
  /your-project/i,
  /x{6,}/i,
  /^0{6,}$/,
  /^1:0+:web:/i,
  /^G-(?:EXAMPLE|X+)$/i,
];

const placeholderKeys = REQUIRED_FIREBASE_WEB_KEYS.filter((key) => {
  const value = getValue(key);
  return value && placeholderPatterns.some((pattern) => pattern.test(value));
});

const formatIssues = (label, keys) => (
  keys.length ? `\n- ${label}: ${keys.join(', ')}` : ''
);

if (missingKeys.length || placeholderKeys.length) {
  console.error([
    'Frontend release build is missing usable Firebase web auth configuration.',
    formatIssues('Missing', missingKeys),
    formatIssues('Placeholder values', placeholderKeys),
    '',
    'Set the VITE_FIREBASE_* web app values or VITE_FIREBASE_CONFIG JSON in the deployment environment before building.',
    'For Vercel, add them under Project Settings > Environment Variables for Production and Preview.',
    'For GitHub desktop or multi-host releases, add them as repository variables or secrets.',
    'Use AURA_SKIP_FRONTEND_AUTH_ENV_VALIDATION=true only for non-auth smoke builds.',
  ].filter(Boolean).join('\n'));
  process.exit(1);
}

