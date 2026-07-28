import fs from 'node:fs';
import { createRequire } from 'node:module';
import { runCommand } from './command.mjs';

const require = createRequire(import.meta.url);
const { signInWithEmailPassword } = require('../../server/scripts/lib/firebaseEmailAuth');

const normalizeUrl = (value) => String(value || '').trim().replace(/\/+$/, '');
const baseUrl = normalizeUrl(process.env.PERF_BASE_URL || process.env.SMOKE_BASE_URL);
const productionUrls = [
  process.env.PROD_BASE_URL,
  process.env.PROD_API_BASE_URL,
].map(normalizeUrl).filter(Boolean);

if (
  process.env.SMOKE_TARGET_ENV !== 'staging'
  || process.env.SMOKE_STAGING_ISOLATED !== 'true'
  || process.env.STAGING_SSM_PREFIX !== '/aura/staging'
  || !/^https:\/\//i.test(baseUrl)
  || productionUrls.includes(baseUrl)
) {
  throw new Error('Account Center k6 requires an explicit isolated HTTPS staging target');
}

const credentials = {
  apiKey: String(process.env.SMOKE_FIREBASE_API_KEY || '').trim(),
  email: String(process.env.SMOKE_USER_EMAIL || '').trim(),
  password: String(process.env.SMOKE_USER_PASSWORD || '').trim(),
};
if (!credentials.apiKey || !credentials.email || !credentials.password) {
  throw new Error('Account Center k6 requires the dedicated staging customer credentials');
}

const version = runCommand('k6', ['version'], { stdio: 'pipe' });
if (version.status !== 0) {
  throw new Error('k6 is required for Account Center staging qualification');
}

const signIn = await signInWithEmailPassword(credentials);
if (!signIn.idToken) {
  throw new Error('Firebase staging sign-in did not return an ID token');
}

fs.mkdirSync('.run-logs', { recursive: true });
const result = runCommand('k6', [
  'run',
  '--summary-export',
  '.run-logs/k6-account-center.json',
  'tests/performance/k6/account-center.js',
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    PERF_BASE_URL: baseUrl,
    PERF_AUTH_TOKEN: signIn.idToken,
  },
});

process.exit(result.status ?? 1);
