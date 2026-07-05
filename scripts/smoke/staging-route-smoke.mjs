#!/usr/bin/env node
import process from 'node:process';
import { applyStagingStateEnv } from '../staging/state-env.mjs';
import {
  KNOWN_PRODUCTION_HOSTS,
  STAGING_SSM_PREFIX,
  getUrlHost,
  isKnownProductionHost,
  looksProductionLike,
  normalize,
  toDisplayUrl,
} from '../env-contract-lib.mjs';

applyStagingStateEnv({ preferState: process.env.STAGING_STATE_PREFER_STATE !== 'false' });

const normalizeUrl = (value) => normalize(value).replace(/\/+$/, '');

const stagingApiBaseUrl = normalize(process.env.STAGING_API_BASE_URL);
const stagingHealthUrl = normalize(process.env.STAGING_HEALTH_URL);
const prodApiBaseUrl = normalize(process.env.PROD_API_BASE_URL);
const prodBaseUrl = normalize(process.env.PROD_BASE_URL);
const scannerReadyRequired = ['1', 'true', 'yes', 'on'].includes(normalize(process.env.SMOKE_REQUIRE_SCANNER_READY).toLowerCase());

const failures = [];
const results = [];

const fail = (message) => failures.push(message);
const containsKnownProductionHost = (value = '') => KNOWN_PRODUCTION_HOSTS.some((host) => normalize(value).toLowerCase().includes(host));

const assertNotProductionUrl = (label, value) => {
  if (!value) {
    fail(`${label} is missing.`);
    return;
  }
  if (normalizeUrl(value) === normalizeUrl(prodApiBaseUrl) || normalizeUrl(value) === normalizeUrl(prodBaseUrl)) {
    fail(`${label} equals a production URL.`);
  }
  if (isKnownProductionHost(value) || looksProductionLike(value)) {
    fail(`${label} points to a production-like origin: ${toDisplayUrl(value)}.`);
  }
};

const headerText = (headers) => {
  const pairs = [];
  headers.forEach((value, key) => pairs.push(`${key}: ${value}`));
  return pairs.join('\n');
};

const assertResponseNotProduction = async (label, response) => {
  const location = response.headers.get('location') || '';
  const server = response.headers.get('server') || '';
  const via = response.headers.get('via') || '';
  const headers = headerText(response.headers);

  for (const [headerName, value] of [
    ['location', location],
    ['server', server],
    ['via', via],
    ['headers', headers],
  ]) {
    if (!value) continue;
    if (isKnownProductionHost(value) || containsKnownProductionHost(value) || looksProductionLike(value)) {
      fail(`${label} response ${headerName} contains a production origin.`);
    }
  }

  if (location) {
    const redirectHost = getUrlHost(location);
    const stagingHost = getUrlHost(stagingApiBaseUrl);
    if (redirectHost && stagingHost && redirectHost !== stagingHost) {
      fail(`${label} redirects away from staging to ${redirectHost}.`);
    }
  }

  const body = await response.clone().text().catch(() => '');
  const bodyLower = body.toLowerCase();
  if (body && (containsKnownProductionHost(body) || bodyLower.includes('/aura/prod'))) {
    fail(`${label} response body contains a production signal.`);
  }
};

const request = async (label, url, options = {}) => {
  assertNotProductionUrl(label, url);
  const response = await fetch(url, {
    redirect: 'manual',
    ...options,
    headers: {
      'user-agent': 'aura-staging-smoke/1.0',
      ...(options.headers || {}),
    },
  });
  await assertResponseNotProduction(label, response);
  results.push(`${label}: ${response.status}`);
  return response;
};

const readJsonSafely = async (response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    fail(`Health response is not valid JSON: ${text.slice(0, 120)}`);
    return {};
  }
};

assertNotProductionUrl('STAGING_API_BASE_URL', stagingApiBaseUrl);
assertNotProductionUrl('STAGING_HEALTH_URL', stagingHealthUrl);

try {
  const healthResponse = await request('health', stagingHealthUrl);
  if (!healthResponse.ok) {
    fail(`Health returned ${healthResponse.status}.`);
  }
  const health = await readJsonSafely(healthResponse);
  if (health.env !== 'staging') fail('Health env must be staging.');
  if (health.ssmPrefix !== STAGING_SSM_PREFIX) fail(`Health ssmPrefix must be ${STAGING_SSM_PREFIX}.`);
  for (const field of ['database', 'cache', 'storage']) {
    const value = normalize(health[field]).toLowerCase();
    if (value !== 'staging') fail(`Health ${field} must be staging; got ${value || '<unset>'}.`);
    if (value.includes('prod') || value.includes('production')) fail(`Health ${field} contains production.`);
  }
  if (health.scanner !== 'ready') {
    const scannerStatus = health.scanner || '<unset>';
    if (scannerReadyRequired) {
      fail(`Health scanner must be ready; got ${scannerStatus}.`);
    } else {
      results.push(`health scanner: ${scannerStatus} (not required)`);
    }
  }

  const apiHealthUrl = `${normalizeUrl(stagingApiBaseUrl)}/api/health`;
  const apiHealthResponse = await request('api health', apiHealthUrl);
  if (![200, 204, 401, 403, 404].includes(apiHealthResponse.status)) {
    fail(`/api/health returned unexpected status ${apiHealthResponse.status}.`);
  }

  const uploadUrl = `${normalizeUrl(stagingApiBaseUrl)}/uploads/smoke-nonexistent.txt`;
  const uploadResponse = await request('uploads', uploadUrl, { method: 'GET' });
  if (![200, 204, 400, 401, 403, 404].includes(uploadResponse.status)) {
    fail(`/uploads smoke returned unexpected status ${uploadResponse.status}.`);
  }

  const socketUrl = `${normalizeUrl(stagingApiBaseUrl)}/socket.io/?EIO=4&transport=polling`;
  const socketResponse = await request('socket.io', socketUrl);
  if (![200, 400].includes(socketResponse.status)) {
    fail(`/socket.io smoke returned unexpected status ${socketResponse.status}.`);
  }
} catch (error) {
  fail(error?.message || 'staging route smoke failed');
}

if (KNOWN_PRODUCTION_HOSTS.some((host) => getUrlHost(stagingApiBaseUrl) === host)) {
  fail('Staging API host is a known production host.');
}

if (failures.length > 0) {
  console.error('FAIL: code is staging-safe, but live staging infrastructure is not present yet');
  for (const result of results) console.error(`- ${result}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('PASS: live staging infrastructure is present');
for (const result of results) console.log(result);
