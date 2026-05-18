import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REQUIRED_FIREBASE_WEB_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
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

const getValue = (key) => String(env[key] || '').trim();

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
    'Set the VITE_FIREBASE_* web app values in the deployment environment before building.',
    'For Vercel, add them under Project Settings > Environment Variables for Production and Preview.',
    'For GitHub desktop or multi-host releases, add them as repository variables or secrets.',
    'Use AURA_SKIP_FRONTEND_AUTH_ENV_VALIDATION=true only for non-auth smoke builds.',
  ].filter(Boolean).join('\n'));
  process.exit(1);
}

