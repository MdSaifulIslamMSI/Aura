#!/usr/bin/env node
import process from 'node:process';
import { applyStagingStateEnv } from '../staging/state-env.mjs';
import {
  KNOWN_PRODUCTION_HOSTS,
  PRODUCTION_SSM_PREFIX,
  STAGING_SSM_PREFIX,
  getUrlHost,
  isKnownProductionHost,
  looksProductionLike,
  normalize,
  toDisplayUrl,
} from '../env-contract-lib.mjs';

applyStagingStateEnv({ preferState: process.env.STAGING_STATE_PREFER_STATE !== 'false' });

const failures = [];

const requireEnv = (name) => {
  const value = normalize(process.env[name]);
  if (!value) failures.push(`${name} is required for staging smoke.`);
  return value;
};

const normalizeUrl = (value) => normalize(value).replace(/\/+$/, '');
const boolEnv = (name) => ['1', 'true', 'yes', 'on'].includes(normalize(process.env[name]).toLowerCase());

const stagingBaseUrl = requireEnv('STAGING_BASE_URL');
const stagingApiBaseUrl = requireEnv('STAGING_API_BASE_URL');
const stagingHealthUrl = requireEnv('STAGING_HEALTH_URL');
const stagingSsmPrefix = requireEnv('STAGING_SSM_PREFIX');
const smokeTargetEnv = requireEnv('SMOKE_TARGET_ENV');
const prodBaseUrl = requireEnv('PROD_BASE_URL');
const prodApiBaseUrl = requireEnv('PROD_API_BASE_URL');
const prodSsmPrefix = requireEnv('PROD_SSM_PREFIX');

if (smokeTargetEnv !== 'staging') {
  failures.push('SMOKE_TARGET_ENV must be staging.');
}
if (stagingSsmPrefix !== STAGING_SSM_PREFIX) {
  failures.push(`STAGING_SSM_PREFIX must be ${STAGING_SSM_PREFIX}.`);
}
if (prodSsmPrefix !== PRODUCTION_SSM_PREFIX) {
  failures.push(`PROD_SSM_PREFIX must be ${PRODUCTION_SSM_PREFIX}.`);
}
if (!boolEnv('SMOKE_REQUIRE_BACKEND_STAGING')) {
  failures.push('SMOKE_REQUIRE_BACKEND_STAGING=true is required.');
}
if (!boolEnv('SMOKE_FORBID_PRODUCTION_ORIGINS')) {
  failures.push('SMOKE_FORBID_PRODUCTION_ORIGINS=true is required.');
}

const productionCandidates = [
  prodBaseUrl,
  prodApiBaseUrl,
  ...KNOWN_PRODUCTION_HOSTS.map((host) => `https://${host}`),
].filter(Boolean);

const equalsProduction = (candidate) => {
  const normalized = normalizeUrl(candidate);
  return productionCandidates.some((prod) => normalizeUrl(prod) === normalized)
    || isKnownProductionHost(candidate);
};

for (const [name, value] of [
  ['STAGING_BASE_URL', stagingBaseUrl],
  ['STAGING_API_BASE_URL', stagingApiBaseUrl],
  ['STAGING_HEALTH_URL', stagingHealthUrl],
]) {
  if (!value) continue;
  if (equalsProduction(value)) failures.push(`${name} must not point to production (${toDisplayUrl(value)}).`);
  if (looksProductionLike(value)) failures.push(`${name} looks production-like (${toDisplayUrl(value)}).`);
  const host = getUrlHost(value);
  if (host && KNOWN_PRODUCTION_HOSTS.some((prodHost) => host === prodHost || host.endsWith(`.${prodHost}`))) {
    failures.push(`${name} contains a known production host: ${host}.`);
  }
}

if (stagingApiBaseUrl && prodApiBaseUrl && normalizeUrl(stagingApiBaseUrl) === normalizeUrl(prodApiBaseUrl)) {
  failures.push('STAGING_API_BASE_URL must not equal PROD_API_BASE_URL.');
}
if (stagingBaseUrl && prodBaseUrl && normalizeUrl(stagingBaseUrl) === normalizeUrl(prodBaseUrl)) {
  failures.push('STAGING_BASE_URL must not equal PROD_BASE_URL.');
}
if (looksProductionLike(stagingSsmPrefix) || stagingSsmPrefix === PRODUCTION_SSM_PREFIX) {
  failures.push('/aura/prod is rejected for staging.');
}

if (failures.length > 0) {
  console.error('FAIL: code is staging-safe, but live staging infrastructure is not present yet');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('PASS: staging smoke contract is safe to request');
console.log(`target env: ${smokeTargetEnv}`);
console.log(`base URL: ${toDisplayUrl(stagingBaseUrl)}`);
console.log(`backend URL: ${toDisplayUrl(stagingApiBaseUrl)}`);
console.log(`health URL: ${toDisplayUrl(stagingHealthUrl)}`);
console.log(`SSM prefix: ${stagingSsmPrefix}`);
