#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
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
import {
  gitSha,
  normalizeUrl,
  redactError,
  repoRoot,
  writeJsonAtomic,
} from '../lib/release-guard-utils.mjs';
import { applyStagingStateEnv } from '../staging/state-env.mjs';

applyStagingStateEnv({ preferState: process.env.STAGING_STATE_PREFER_STATE !== 'false' });

const artifactDir = path.join(repoRoot, 'artifacts', 'sre');
const sampleCount = Math.max(2, Math.min(Number(process.env.SRE_SYNTHETIC_SAMPLE_COUNT || 5), 10));
const hardTimeoutMs = Math.max(1000, Math.min(Number(process.env.SRE_SYNTHETIC_HARD_TIMEOUT_MS || 15000), 30000));
const allowedBudgetMisses = Math.max(0, Math.min(Number(process.env.SRE_ALLOWED_BUDGET_MISSES || 1), sampleCount - 1));

const budgets = {
  healthMs: Math.max(1, Number(process.env.SRE_HEALTH_BUDGET_MS || 250)),
  frontendHtmlMs: Math.max(1, Number(process.env.SRE_FRONTEND_HTML_BUDGET_MS || 1000)),
  staticAssetMs: Math.max(1, Number(process.env.SRE_STATIC_ASSET_BUDGET_MS || 1000)),
  socketMs: Math.max(1, Number(process.env.SRE_SOCKET_BUDGET_MS || 1500)),
};

const failures = [];
const warnings = [];
const observations = [];
const checks = [];

const fail = (message) => failures.push(message);
const note = (message) => observations.push(message);

const stagingFrontendUrl = normalizeUrl(process.env.STAGING_FRONTEND_URL || process.env.STAGING_BASE_URL || '');
const stagingApiBaseUrl = normalizeUrl(process.env.STAGING_API_BASE_URL || '');
const stagingHealthUrl = normalizeUrl(process.env.STAGING_HEALTH_URL || (stagingApiBaseUrl ? `${stagingApiBaseUrl}/health` : ''));
const prodBaseUrl = normalizeUrl(process.env.PROD_BASE_URL || '');
const prodApiBaseUrl = normalizeUrl(process.env.PROD_API_BASE_URL || '');
const socketDisabled = ['1', 'true', 'yes', 'on'].includes(normalize(process.env.SRE_SOCKET_DISABLED).toLowerCase());

const productionSignals = [
  prodBaseUrl,
  prodApiBaseUrl,
  ...KNOWN_PRODUCTION_HOSTS.map((host) => `https://${host}`),
].filter(Boolean).map((value) => normalize(value).toLowerCase());

const containsProductionSignal = (value = '') => {
  const text = normalize(value).toLowerCase();
  if (!text) return false;
  return productionSignals.some((signal) => signal && text.includes(signal))
    || KNOWN_PRODUCTION_HOSTS.some((host) => text.includes(host))
    || text.includes(PRODUCTION_SSM_PREFIX);
};

const assertStagingUrl = (label, value) => {
  if (!value) {
    fail(`${label} is required.`);
    return;
  }
  if (normalize(process.env.SMOKE_TARGET_ENV) !== 'staging') fail('SMOKE_TARGET_ENV must be staging.');
  if (normalize(process.env.STAGING_SSM_PREFIX) !== STAGING_SSM_PREFIX) {
    fail(`STAGING_SSM_PREFIX must be ${STAGING_SSM_PREFIX}.`);
  }
  if (prodBaseUrl && value === prodBaseUrl) fail(`${label} must not equal PROD_BASE_URL.`);
  if (prodApiBaseUrl && value === prodApiBaseUrl) fail(`${label} must not equal PROD_API_BASE_URL.`);
  if (isKnownProductionHost(value) || looksProductionLike(value)) {
    fail(`${label} points to a production-like origin: ${toDisplayUrl(value)}.`);
  }
};

const headersText = (headers) => {
  const values = [];
  headers.forEach((value, key) => values.push(`${key}: ${value}`));
  return values.join('\n');
};

const scanResponseForProduction = async (label, response) => {
  const headerSnapshot = headersText(response.headers);
  if (containsProductionSignal(headerSnapshot)) {
    fail(`${label} response headers contain a production signal.`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!/text|json|javascript|css|html/i.test(contentType)) return '';
  const text = await response.clone().text().catch(() => '');
  if (containsProductionSignal(text)) {
    fail(`${label} response body contains a production signal.`);
  }
  return text;
};

const timedFetch = async (label, url, {
  budgetMs,
  allowedStatuses = [200],
  method = 'GET',
  scanBody = true,
} = {}) => {
  assertStagingUrl(label, url);
  if (failures.length > 0) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), hardTimeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      method,
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        'user-agent': 'aura-sre-synthetic/1.0',
      },
    });
    const durationMs = Math.round(performance.now() - startedAt);
    const body = scanBody ? await scanResponseForProduction(label, response) : '';
    const statusOk = allowedStatuses.includes(response.status);
    const budgetOk = !budgetMs || durationMs <= budgetMs;
    checks.push({
      label,
      status: response.status,
      durationMs,
      budgetMs,
      statusOk,
      budgetOk,
    });
    if (!statusOk) fail(`${label} returned ${response.status}; expected ${allowedStatuses.join('/')}.`);
    return { response, body, durationMs };
  } catch (error) {
    fail(`${label} request failed: ${redactError(error?.message || String(error))}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const percentile = (values, ratio) => {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
};

const runSampledCheck = async (label, url, options) => {
  const durations = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const result = await timedFetch(`${label} sample ${index + 1}`, url, options);
    if (result) durations.push(result.durationMs);
  }
  const summary = {
    label,
    samples: durations.length,
    minMs: durations.length ? Math.min(...durations) : 0,
    medianMs: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maxMs: durations.length ? Math.max(...durations) : 0,
    budgetMs: options.budgetMs,
  };
  const misses = durations.filter((duration) => duration > options.budgetMs).length;
  if (misses > allowedBudgetMisses) {
    fail(`${label} exceeded ${options.budgetMs}ms budget ${misses}/${durations.length} times.`);
  }
  checks.push(summary);
};

const parseAssetUrls = (html = '', baseUrl = '') => {
  const urls = new Set();
  for (const match of html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)=["']([^"']+)["']/gi)) {
    const raw = match[1];
    if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) continue;
    try {
      const url = new URL(raw, `${normalizeUrl(baseUrl)}/`).toString();
      if (/\.(?:js|mjs|css)(?:\?|$)/i.test(url)) urls.add(url);
    } catch {
      // Ignore malformed asset refs; the status check records reachable assets.
    }
  }
  return Array.from(urls).slice(0, 5);
};

assertStagingUrl('STAGING_FRONTEND_URL', stagingFrontendUrl);
assertStagingUrl('STAGING_API_BASE_URL', stagingApiBaseUrl);
assertStagingUrl('STAGING_HEALTH_URL', stagingHealthUrl);

if (failures.length === 0 && getUrlHost(stagingFrontendUrl) === getUrlHost(prodBaseUrl)) {
  fail('staging frontend host must not equal production frontend host.');
}
if (failures.length === 0 && getUrlHost(stagingApiBaseUrl) === getUrlHost(prodApiBaseUrl)) {
  fail('staging API host must not equal production API host.');
}

if (failures.length === 0) {
  await runSampledCheck('health', stagingHealthUrl, {
    budgetMs: budgets.healthMs,
    allowedStatuses: [200],
  });

  await runSampledCheck('api health', `${stagingApiBaseUrl}/api/health`, {
    budgetMs: budgets.healthMs,
    allowedStatuses: [200],
  });

  const readyUrl = `${stagingApiBaseUrl}/api/ready`;
  const ready = await timedFetch('api ready optional', readyUrl, {
    budgetMs: budgets.healthMs,
    allowedStatuses: [200, 404],
  });
  if (ready?.response?.status === 404) {
    note('/api/ready is not registered; /api/health/ready remains the readiness path.');
  }

  const frontend = await timedFetch('frontend html', stagingFrontendUrl, {
    budgetMs: budgets.frontendHtmlMs,
    allowedStatuses: [200],
  });
  if (frontend?.body) {
    for (const assetUrl of parseAssetUrls(frontend.body, stagingFrontendUrl)) {
      await timedFetch(`static asset ${toDisplayUrl(assetUrl)}`, assetUrl, {
        budgetMs: budgets.staticAssetMs,
        allowedStatuses: [200],
        scanBody: false,
      });
    }
  }

  await timedFetch('frontend api proxy health', `${stagingFrontendUrl}/api/health`, {
    budgetMs: budgets.healthMs,
    allowedStatuses: [200, 204, 401, 403, 404],
  });

  if (socketDisabled) {
    note('socket.io check skipped because SRE_SOCKET_DISABLED is true.');
  } else {
    await timedFetch('socket.io handshake', `${stagingApiBaseUrl}/socket.io/?EIO=4&transport=polling`, {
      budgetMs: budgets.socketMs,
      allowedStatuses: [200, 400],
      scanBody: false,
    });
  }
}

const evidence = {
  status: failures.length === 0 ? 'pass' : 'fail',
  gitSha: gitSha(),
  generatedAt: new Date().toISOString(),
  sampleCount,
  allowedBudgetMisses,
  budgets,
  target: {
    frontendHost: getUrlHost(stagingFrontendUrl),
    apiHost: getUrlHost(stagingApiBaseUrl),
    healthHost: getUrlHost(stagingHealthUrl),
    ssmPrefix: process.env.STAGING_SSM_PREFIX || '',
  },
  checks,
  warnings,
  observations,
  failures,
};

writeJsonAtomic(path.join(artifactDir, 'synthetic-staging-check.json'), evidence);

if (failures.length > 0) {
  console.error('FAIL: SRE synthetic staging check blocked release');
  for (const warning of warnings) console.error(`WARN: ${warning}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('PASS: SRE synthetic staging check');
console.log(`samples=${sampleCount} healthBudgetMs=${budgets.healthMs} frontendBudgetMs=${budgets.frontendHtmlMs}`);
for (const observation of observations) console.log(`INFO: ${observation}`);
