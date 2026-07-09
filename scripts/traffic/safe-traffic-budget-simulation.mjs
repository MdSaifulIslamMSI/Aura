import path from 'node:path';
import {
  buildTrafficAuditReport,
  checkFail,
  checkPass,
  parseTrafficAuditArgs,
  renderTrafficAuditMarkdown,
  writeTrafficAuditOutputs,
} from './traffic-audit-utils.mjs';

const options = parseTrafficAuditArgs(process.argv.slice(2));
const args = new Set(process.argv.slice(2));
const env = process.env;
const target = String(env.STAGING_BASE_URL || env.STAGING_FRONTEND_URL || env.TRAFFIC_SIMULATION_TARGET_URL || '').replace(/\/+$/, '');
const frontendTarget = String(env.STAGING_FRONTEND_URL || target || '').replace(/\/+$/, '');
const productionAllowed = String(env.ALLOW_PRODUCTION_TRAFFIC_SIMULATION || '').trim().toLowerCase() === 'true';
const runNetwork = args.has('--run');
const isLocal = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(target);
const isStaging = /staging|localhost|127\.0\.0\.1/i.test(target)
  || String(env.SMOKE_TARGET_ENV || '').trim().toLowerCase() === 'staging';
const isProductionLike = target && !isLocal && !isStaging;

const plannedRequests = [
  { label: 'public browsing burst', method: 'GET', url: `${target}/api/products?limit=8`, expectedStatus: [200, 304, 401, 403, 429, 503] },
  { label: 'normal API health', method: 'GET', url: `${target}/health/live`, expectedStatus: [200, 503] },
  { label: 'frontend load', method: 'GET', url: frontendTarget || target, expectedStatus: [200, 304] },
  { label: 'cacheable static asset', method: 'GET', url: `${frontendTarget || target}/favicon.ico`, expectedStatus: [200, 304, 404] },
  { label: 'protected route expects auth failure', method: 'GET', url: `${target}/api/cart`, expectedStatus: [401, 403, 429, 503] },
];

const checks = [];
checks.push((target ? checkPass : checkFail)({
  id: 'simulation.staging-target-present',
  title: 'Staging target is configured',
  summary: target ? 'A staging/local target is configured.' : 'STAGING_BASE_URL or STAGING_FRONTEND_URL is required.',
  evidence: { target: target ? '[configured-target]' : '' },
  scope: target ? 'repo' : 'policy',
}));
checks.push((!isProductionLike || productionAllowed ? checkPass : checkFail)({
  id: 'simulation.production-refused',
  title: 'Production simulation is refused by default',
  summary: isProductionLike && !productionAllowed
    ? 'Target appears production-like and ALLOW_PRODUCTION_TRAFFIC_SIMULATION=true is not set.'
    : 'Target is staging/local or explicit production simulation approval is set.',
  evidence: { isProductionLike, productionAllowed },
  scope: isProductionLike && !productionAllowed ? 'policy' : 'repo',
}));
checks.push(checkPass({
  id: 'simulation.no-destructive-requests',
  title: 'Simulation plan is read-only and low sample',
  summary: 'Plan uses health, public read, frontend/static, and one protected read expecting 401/403.',
  evidence: { plannedRequests: plannedRequests.map((entry) => ({ label: entry.label, method: entry.method })) },
}));

const results = [];
const fetchWithTimeout = async (entry) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(entry.url, {
      method: entry.method,
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': 'aura-safe-traffic-budget-simulation' },
    });
    return { ...entry, status: response.status, ok: entry.expectedStatus.includes(response.status) };
  } catch (error) {
    return { ...entry, status: 0, ok: false, error: error?.message || 'request failed' };
  } finally {
    clearTimeout(timeout);
  }
};

if (target && (!isProductionLike || productionAllowed) && runNetwork) {
  for (const entry of plannedRequests) {
    results.push(await fetchWithTimeout(entry));
  }
  for (const result of results) {
    checks.push((result.ok ? checkPass : checkFail)({
      id: `simulation.result.${result.label.replace(/[^a-z0-9]+/gi, '-')}`,
      title: `${result.label} returned expected status`,
      summary: `${result.method} ${result.url.replace(target, '[target]')} returned ${result.status}.`,
      evidence: { status: result.status, expectedStatus: result.expectedStatus, error: result.error || '' },
      scope: result.ok ? 'repo' : 'policy',
    }));
  }
}

const report = buildTrafficAuditReport({
  title: 'Safe Traffic Budget Simulation',
  checks,
  options,
  extra: {
    target: target ? '[configured-target]' : '[missing]',
    networkRequestsSent: Boolean(runNetwork && results.length),
    plannedRequests: plannedRequests.map((entry) => ({
      label: entry.label,
      method: entry.method,
      url: entry.url.replace(target, '[target]'),
      expectedStatus: entry.expectedStatus,
    })),
    results: results.map((entry) => ({
      label: entry.label,
      status: entry.status,
      ok: entry.ok,
      error: entry.error || '',
    })),
  },
});

const markdown = renderTrafficAuditMarkdown(report, [
  '## Simulation Plan',
  '',
  ...plannedRequests.map((entry) => `- ${entry.label}: ${entry.method} ${entry.url.replace(target, '[target]')}`),
  '',
  `Network requests sent: ${Boolean(runNetwork && results.length)}`,
  '',
  '## Safety Contract',
  '',
  '- Staging/local by default.',
  '- Production requires ALLOW_PRODUCTION_TRAFFIC_SIMULATION=true.',
  '- No OTP/email/SMS, payment mutation, upload flood, or AI-cost routes are called.',
]);
const written = writeTrafficAuditOutputs({
  report,
  markdown,
  options,
  baseName: 'safe-traffic-simulation',
});

console.log(`[traffic:simulate:staging] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
if (report.status === 'fail') process.exit(1);
