#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  getUrlHost,
  gitSha,
  normalize,
  normalizeUrl,
  writeEvidence,
} from '../lib/release-guard-utils.mjs';
import { applyStagingStateEnv } from '../staging/state-env.mjs';

applyStagingStateEnv({ preferState: process.env.STAGING_STATE_PREFER_STATE !== 'false' });

const failures = [];

const requireEnv = (name) => {
  const value = normalize(process.env[name]);
  if (!value) failures.push(`${name} is required.`);
  return value;
};

const stagingBaseUrl = requireEnv('STAGING_BASE_URL');
const stagingApiBaseUrl = requireEnv('STAGING_API_BASE_URL');
const stagingHealthUrl = requireEnv('STAGING_HEALTH_URL');
const stagingFrontendUrl = requireEnv('STAGING_FRONTEND_URL');
const prodBaseUrl = normalize(process.env.PROD_BASE_URL);
const prodApiBaseUrl = normalize(process.env.PROD_API_BASE_URL);

if (normalize(process.env.SMOKE_TARGET_ENV) !== 'staging') failures.push('SMOKE_TARGET_ENV must be staging.');
if (normalize(process.env.STAGING_SSM_PREFIX) !== '/aura/staging') failures.push('STAGING_SSM_PREFIX must be /aura/staging.');
if (normalize(process.env.PROD_SSM_PREFIX || '/aura/prod') !== '/aura/prod') failures.push('PROD_SSM_PREFIX must be /aura/prod.');

for (const [label, stagingValue, prodValue] of [
  ['STAGING_BASE_URL', stagingBaseUrl, prodBaseUrl],
  ['STAGING_API_BASE_URL', stagingApiBaseUrl, prodApiBaseUrl],
  ['STAGING_FRONTEND_URL', stagingFrontendUrl, prodBaseUrl],
]) {
  if (stagingValue && prodValue && normalizeUrl(stagingValue) === normalizeUrl(prodValue)) {
    failures.push(`${label} must not equal a production URL.`);
  }
}

if (stagingBaseUrl && prodBaseUrl && getUrlHost(stagingBaseUrl) === getUrlHost(prodBaseUrl)) {
  failures.push('staging host must not equal production host.');
}
if (stagingApiBaseUrl && prodApiBaseUrl && getUrlHost(stagingApiBaseUrl) === getUrlHost(prodApiBaseUrl)) {
  failures.push('staging API host must not equal production API host.');
}

const runNodeScript = (script) => {
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.status !== 0) failures.push(`${script} failed:\n${output.trim()}`);
  return output;
};

if (failures.length === 0) {
  runNodeScript('scripts/smoke/assert-staging-contract.mjs');
  runNodeScript('scripts/smoke/staging-route-smoke.mjs');
  runNodeScript('scripts/smoke/assert-frontend-staging-target.mjs');
}

if (failures.length > 0) {
  console.error('FAIL: environment contract is not safe');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const evidence = {
  status: 'pass',
  stagingBaseUrl,
  stagingApiBaseUrl,
  stagingHealthUrl,
  stagingFrontendUrl,
  ssmPrefix: '/aura/staging',
  gitSha: gitSha(),
  checks: [
    'staging health env=staging',
    'staging SSM prefix=/aura/staging',
    'staging database/cache/storage proof',
    'frontend /api route proof',
    'frontend /uploads route proof',
    'socket.io route proof',
    'production signal scan',
  ],
};
writeEvidence('staging-smoke', evidence);
writeEvidence('env-contract', evidence);
console.log('PASS: full staging environment contract is safe');
