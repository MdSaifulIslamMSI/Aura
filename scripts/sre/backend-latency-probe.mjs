#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import {
  KNOWN_PRODUCTION_HOSTS,
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
const targetEnv = normalize(process.env.SRE_TARGET_ENV || process.env.SMOKE_TARGET_ENV || 'staging').toLowerCase();
const sampleCount = Math.max(3, Math.min(Number(process.env.SRE_LATENCY_SAMPLE_COUNT || 7), 20));
const hardTimeoutMs = Math.max(1000, Math.min(Number(process.env.SRE_LATENCY_HARD_TIMEOUT_MS || 15000), 30000));
const healthBudgetMs = Math.max(1, Number(process.env.SRE_LATENCY_HEALTH_BUDGET_MS || 250));
const apiBudgetMs = Math.max(1, Number(process.env.SRE_LATENCY_API_BUDGET_MS || 800));

const failures = [];
const warnings = [];
const results = [];

const isTruthy = (value = '') => ['1', 'true', 'yes', 'on'].includes(normalize(value).toLowerCase());
const fail = (message) => failures.push(message);

if (!['staging', 'production'].includes(targetEnv)) {
  const reportedTargetEnv = targetEnv || '<unset>';
  fail(`SRE_TARGET_ENV must be an allowed live target; got ${reportedTargetEnv}.`);
}
if (targetEnv === 'production' && !isTruthy(process.env.ALLOW_PRODUCTION_LATENCY_PROBE)) {
  fail('Production latency probe requires ALLOW_PRODUCTION_LATENCY_PROBE=true.');
}

const baseUrl = targetEnv === 'production'
  ? normalizeUrl(process.env.PROD_API_BASE_URL || process.env.AURA_BACKEND_ORIGIN || '')
  : normalizeUrl(process.env.STAGING_API_BASE_URL || '');
const prodBaseUrl = normalizeUrl(process.env.PROD_API_BASE_URL || process.env.AURA_BACKEND_ORIGIN || '');

if (!baseUrl) {
  fail(`${targetEnv === 'production' ? 'PROD_API_BASE_URL' : 'STAGING_API_BASE_URL'} is required.`);
}
if (targetEnv === 'staging') {
  if (normalize(process.env.SMOKE_TARGET_ENV) !== 'staging') fail('SMOKE_TARGET_ENV must be staging.');
  if (prodBaseUrl && baseUrl === prodBaseUrl) fail('STAGING_API_BASE_URL must not equal production API URL.');
  if (isKnownProductionHost(baseUrl) || looksProductionLike(baseUrl)) {
    fail(`STAGING_API_BASE_URL points to a production-like origin: ${toDisplayUrl(baseUrl)}.`);
  }
}

const paths = normalize(process.env.SRE_LATENCY_PATHS || '/health,/api/health')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

if (paths.length === 0) fail('At least one SRE latency path is required.');
for (const routePath of paths) {
  if (!routePath.startsWith('/')) fail(`Latency path must start with /: ${routePath}.`);
  if (/\/(?:delete|purge|reset|wipe|migrate|deploy|teardown)(?:\/|$)/i.test(routePath)) {
    fail(`Latency path is not safe for read-only probing: ${routePath}.`);
  }
}

const productionSignals = [
  prodBaseUrl,
  ...KNOWN_PRODUCTION_HOSTS.map((host) => `https://${host}`),
].filter(Boolean).map((value) => normalize(value).toLowerCase());

const containsProductionSignal = (value = '') => {
  const text = normalize(value).toLowerCase();
  if (!text) return false;
  return productionSignals.some((signal) => signal && text.includes(signal))
    || KNOWN_PRODUCTION_HOSTS.some((host) => text.includes(host))
    || text.includes('/aura/prod');
};

const percentile = (values, ratio) => {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
};

const probe = async (routePath) => {
  const url = new URL(routePath, `${baseUrl}/`).toString();
  const durations = [];
  const statuses = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), hardTimeoutMs);
    const startedAt = performance.now();
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'aura-sre-latency-probe/1.0' },
      });
      const durationMs = Math.round(performance.now() - startedAt);
      durations.push(durationMs);
      statuses.push(response.status);
      const headerText = [];
      response.headers.forEach((value, key) => headerText.push(`${key}: ${value}`));
      if (targetEnv === 'staging' && containsProductionSignal(headerText.join('\n'))) {
        fail(`${routePath} response headers contain a production signal.`);
      }
      if (!response.ok) {
        fail(`${routePath} sample ${index + 1} returned HTTP ${response.status}.`);
      }
    } catch (error) {
      fail(`${routePath} sample ${index + 1} failed: ${redactError(error?.message || String(error))}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  const budgetMs = routePath.includes('health') ? healthBudgetMs : apiBudgetMs;
  const summary = {
    path: routePath,
    samples: durations.length,
    statuses,
    minMs: durations.length ? Math.min(...durations) : 0,
    medianMs: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maxMs: durations.length ? Math.max(...durations) : 0,
    budgetMs,
  };
  if (summary.p95Ms > budgetMs) {
    fail(`${routePath} p95 ${summary.p95Ms}ms exceeds budget ${budgetMs}ms.`);
  }
  results.push(summary);
};

if (failures.length === 0) {
  for (const routePath of paths) {
    await probe(routePath);
  }
}

const evidence = {
  status: failures.length === 0 ? 'pass' : 'fail',
  gitSha: gitSha(),
  generatedAt: new Date().toISOString(),
  targetEnv,
  targetHost: getUrlHost(baseUrl),
  sampleCount,
  hardTimeoutMs,
  healthBudgetMs,
  apiBudgetMs,
  results,
  warnings,
  failures,
};

writeJsonAtomic(path.join(artifactDir, 'backend-latency-probe.json'), evidence);

if (failures.length > 0) {
  console.error('FAIL: backend latency probe blocked release');
  for (const warning of warnings) console.error(`WARN: ${warning}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('PASS: backend latency probe');
for (const result of results) {
  console.log(`${result.path} samples=${result.samples} medianMs=${result.medianMs} p95Ms=${result.p95Ms} maxMs=${result.maxMs} budgetMs=${result.budgetMs}`);
}
