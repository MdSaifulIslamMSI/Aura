import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  check,
  defaultRepoRoot,
  markdownTable,
  parseReadinessArgs,
  readJsonIfExists,
  readTextIfExists,
  renderChecksMarkdown,
  repoPath,
  shouldFail,
  summarizeChecks,
  writeReadinessReports,
} from './pqc-readiness-utils.mjs';

export const TRAFFIC_MATRIX_ROWS = [
  ['cdn-edge-ddos', 'CDN/edge DDoS protection', 'provider', 'documented', 'infra/security/cloudflare-origin-allowlist.md', 'scripts/security/check-origin-exposure.mjs', 'Disable proxy rules and restore previous DNS only after incident review.', 'Cloudflare proxy and WAF toggles', 'Direct origin exposure', 'edge_4xx_5xx_spike'],
  ['waf-rules', 'WAF rules', 'infra', 'documented', 'infra/waf/README.md', 'scripts/security/waf-smoke-test.mjs', 'Return WAF to detection mode.', 'WAF blocking mode', 'False positives or bypass', 'waf_block_rate'],
  ['bot-risk', 'bot challenge/risk scoring', 'app', 'enforced', 'server/middleware/abuseShield.js', 'server/tests/abuseShield.test.js', 'Disable ABUSE_SHIELD_BLOCKING_ENABLED.', 'ABUSE_SHIELD_BLOCKING_ENABLED', 'Credential stuffing or bot scraping', 'abuse_score_blocks'],
  ['edge-rate-limits', 'edge rate limits', 'provider', 'documented', 'infra/cloudflare/free-security-rules.json', 'scripts/security/traffic-resilience-matrix-check.mjs', 'Revert rate-limit rule in provider dashboard.', 'Provider managed', 'Origin receives avoidable floods', 'edge_rate_limit_blocks'],
  ['api-route-rate-limits', 'API route rate limits', 'app', 'enforced', 'server/middleware/trafficBudgetPolicy.js', 'server/tests/rateLimitCoverage.test.js', 'Set TRAFFIC_BUDGET_LIMITS_ENABLED=false only during approved rollback.', 'TRAFFIC_BUDGET_LIMITS_ENABLED', 'Route budget exhaustion', 'http_429_rate'],
  ['redis-distributed-limits', 'Redis distributed rate limits', 'app', 'enforced', 'server/middleware/distributedRateLimit.js', 'server/tests/distributedRateLimit.test.js', 'Fail sensitive routes closed; public fallback stays bounded.', 'REDIS_URL and production Redis requirement', 'Horizontal bypass of memory-only limits', 'redis_errors'],
  ['express-front-door-limits', 'express-rate-limit scanner-recognized front-door limits', 'app', 'enforced', 'server/routes/paymentRoutes.js', 'server/tests/rate-limit.bypass.security.test.js', 'Keep distributed limiters active while scanner limiter is tuned.', 'Route-level limiter config', 'Scanner-visible limit missing', 'http_429_rate'],
  ['upload-throttling', 'upload throttling', 'app', 'enforced', 'server/middleware/bodySizeGuards.js', 'server/tests/trafficBudgetPolicy.test.js', 'Disable upload writes with attack mode.', 'ATTACK_MODE_BLOCK_UPLOADS', 'Upload storms exhaust memory/scanner', 'upload_security_events'],
  ['otp-email-quota', 'OTP/email quota limits', 'app', 'enforced', 'server/routes/otpRoutes.js', 'server/tests/otpRoutes.test.js', 'Disable OTP send emergency flag.', 'DISABLE_OTP_SEND', 'OTP or email cost spike', 'otp_failure_spike'],
  ['payment-quota', 'payment intent/refund quota limits', 'app', 'enforced', 'server/routes/paymentRoutes.js', 'server/tests/payments.webhook.security.test.js', 'Disable payment writes, keep webhooks verified.', 'DISABLE_PAYMENT', 'Payment provider cost or refund abuse', 'payment_failure_spike'],
  ['ai-quota', 'AI endpoint quota limits', 'app', 'enforced', 'server/routes/aiRoutes.js', 'server/tests/aiRateLimitPolicy.test.js', 'Block AI first in attack mode.', 'ATTACK_MODE_BLOCK_AI', 'AI provider cost spike', 'ai_cost_spike'],
  ['search-throttle', 'search/scraping throttle', 'app', 'enforced', 'server/middleware/queryBudgetGuard.js', 'server/tests/databasePressureResilience.test.js', 'Public read-only mode sheds search.', 'ATTACK_MODE_PUBLIC_READ_ONLY', 'MongoDB search pressure', 'search_latency_p95'],
  ['db-pool', 'DB connection pool limits', 'app', 'documented', 'docs/security/database-pressure-resilience.md', 'scripts/security/database-pressure-check.mjs', 'Rollback pool values through deployment config.', 'DB pool env vars', 'Connection exhaustion', 'db_connections'],
  ['query-timeouts', 'query timeout limits', 'app', 'enforced', 'server/services/catalogService.js', 'scripts/security/database-pressure-check.mjs', 'Use conservative maxTimeMS defaults.', 'TRAFFIC_FORTRESS_ENABLED', 'Long query pileups', 'db_query_duration'],
  ['redis-limits', 'Redis connection limits', 'app', 'documented', 'docs/security/backpressure-queue-resilience.md', 'scripts/security/backpressure-readiness-check.mjs', 'Fail closed for sensitive route limiters.', 'REDIS_URL', 'Redis connection exhaustion', 'redis_errors'],
  ['queue-backpressure', 'queue/backpressure for expensive work', 'app', 'documented', 'docs/security/backpressure-queue-resilience.md', 'scripts/security/backpressure-readiness-check.mjs', 'Pause non-critical workers.', 'ATTACK_MODE_BLOCK_AI', 'Queue growth', 'queue_depth'],
  ['provider-breakers', 'circuit breakers for providers', 'app', 'documented', 'docs/security/provider-circuit-breakers.md', 'scripts/security/provider-circuit-breaker-check.mjs', 'Open provider circuit and use fallback UX.', 'Provider-specific breaker flags', 'Provider outage cascade', 'provider_failure_rate'],
  ['cache-swr', 'cache/stale-while-revalidate', 'app', 'enforced', 'server/middleware/cachePolicy.js', 'server/tests/cacheResilience.test.js', 'Purge public cache or set no-store.', 'CACHE_ENABLED', 'Origin hit amplification', 'cache_hit_ratio'],
  ['health-readiness', 'health and readiness endpoints', 'app', 'enforced', 'server/routes/healthRoutes.js', 'server/tests/healthRoutes.test.js', 'Keep liveness minimal.', 'HEALTH_READY_TOKEN', 'Health endpoint overload', 'health_latency'],
  ['autoscaling', 'autoscaling guidance', 'infra', 'documented', 'docs/security/traffic-resilience-production-rollout.md', 'scripts/security/traffic-resilience-proof.mjs', 'Scale down after attack window.', 'Provider autoscaling config', 'Origin capacity ceiling', 'cpu_memory_pressure'],
  ['cost-guardrails', 'cost guardrails', 'app', 'documented', 'docs/security/traffic-resilient-security-fortress.md', 'scripts/security/security-maturity-scorecard.mjs', 'Disable costly non-critical providers.', 'ATTACK_MODE_BLOCK_AI', 'Unexpected spend', 'cost_spike'],
  ['incident-runbook', 'incident runbook', 'app', 'documented', 'docs/security/ddos-bot-abuse-runbook.md', 'scripts/security/traffic-resilience-proof.mjs', 'Follow rollback section per mode.', 'Emergency controls', 'Uncoordinated incident response', 'incident_open'],
  ['observability-alerting', 'observability/alerting', 'app', 'documented', 'docs/security/traffic-observability-alerting.md', 'scripts/security/traffic-observability-check.mjs', 'Disable noisy alert rule only with incident note.', 'Prometheus/Alertmanager config', 'Blind overload', 'alert_missing'],
  ['safe-load-proof', 'safe load-test proof', 'future', 'staging-only', 'docs/security/load-drill-playbook.md', 'scripts/security/safe-traffic-simulation.mjs', 'Stop local/staging drill immediately.', 'TRAFFIC_SIMULATION_ALLOW_PRODUCTION_READONLY', 'Unsafe drill target', 'load_drill_result'],
  ['safe-bot-simulation', 'safe bot-abuse simulation', 'future', 'staging-only', 'docs/security/safe-traffic-simulation.md', 'scripts/security/safe-traffic-simulation.mjs', 'Dry-run only by default.', 'TRAFFIC_SIMULATION_DRY_RUN', 'Accidental live abuse traffic', 'simulation_refused'],
].map(([id, category, owner, status, evidenceFile, testFile, rollback, productionToggle, failureMode, alert]) => ({
  id,
  category,
  owner,
  status,
  evidenceFile,
  testFile,
  rollback,
  productionToggle,
  failureMode,
  alert,
}));

export const SAFE_SIMULATION_PROFILES = new Set(['baseline', 'search-scrape', 'mixed-bot', 'status-survival']);
export const DESTRUCTIVE_SIMULATION_PROFILES = new Set(['login-abuse', 'otp-abuse', 'upload-abuse', 'ai-abuse', 'payment-abuse']);

export const parseTrafficArgs = (argv, defaults = {}) => {
  const options = parseReadinessArgs(argv, defaults);
  options.profile = 'baseline';
  options.targetUrl = '';
  options.local = false;
  options.staging = false;
  options.dryRun = true;
  options.production = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') {
      options.profile = String(argv[index + 1] || 'baseline').trim();
      index += 1;
    } else if (arg === '--target' || arg === '--target-url') {
      options.targetUrl = String(argv[index + 1] || '').trim();
      index += 1;
    } else if (arg === '--local') {
      options.local = true;
    } else if (arg === '--staging') {
      options.staging = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--run') {
      options.dryRun = false;
    } else if (arg === '--production') {
      options.production = true;
    }
  }
  return options;
};

const textIncludesAll = (text, terms) => terms.every((term) => text.toLowerCase().includes(String(term).toLowerCase()));
const fileExists = (root, relativeFile) => existsSync(repoPath(root, relativeFile));
const readSource = (root, relativeFile) => readTextIfExists(repoPath(root, relativeFile));

const fileCheck = (root, relativeFile, idPrefix = 'file') => check({
  id: `${idPrefix}.${relativeFile}`,
  title: `${relativeFile} exists`,
  status: fileExists(root, relativeFile) ? 'pass' : 'fail',
  scope: 'repo',
  severity: fileExists(root, relativeFile) ? 'info' : 'high',
  summary: fileExists(root, relativeFile) ? `${relativeFile} exists.` : `${relativeFile} is missing.`,
  evidence: { file: relativeFile },
});

export const renderTrafficReportMarkdown = (report, sections = []) => renderChecksMarkdown(report, sections);

export const writeTrafficReport = ({ report, markdown, reportDir, baseName, options }) => writeReadinessReports({
  report,
  markdown,
  reportDir,
  baseName,
  options,
});

const buildReport = ({ title, checks, options = {}, extra = {} }) => {
  const summary = summarizeChecks(checks);
  return {
    title,
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    summary,
    checks,
    ...extra,
  };
};

export const buildTrafficResilienceMatrixReport = (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const checks = [
    fileCheck(root, 'docs/security/traffic-resilience-matrix.md', 'matrix.doc'),
    fileCheck(root, 'server/config/trafficBudgets.js', 'matrix.runtime'),
    fileCheck(root, 'server/middleware/trafficBudgetPolicy.js', 'matrix.runtime'),
    fileCheck(root, 'server/middleware/loadShedding.js', 'matrix.runtime'),
  ];

  for (const row of TRAFFIC_MATRIX_ROWS) {
    checks.push(check({
      id: `matrix.row.${row.id}`,
      title: `${row.category} matrix row has evidence`,
      status: fileExists(root, row.evidenceFile) && fileExists(root, row.testFile) ? 'pass' : 'fail',
      scope: 'repo',
      severity: fileExists(root, row.evidenceFile) && fileExists(root, row.testFile) ? 'info' : 'high',
      summary: `${row.owner}/${row.status}: ${row.evidenceFile} + ${row.testFile}`,
      evidence: { evidenceFile: row.evidenceFile, testFile: row.testFile },
    }));
  }

  return buildReport({
    title: 'Traffic Resilience Matrix',
    checks,
    options,
    extra: {
      rows: TRAFFIC_MATRIX_ROWS,
      limitations: [
        'The matrix proves app, repo, and deploy evidence. It is not a claim of unlimited DDoS survival.',
        'Volumetric traffic must be absorbed by CDN/WAF/provider controls before it reaches origin.',
      ],
    },
  });
};

const dangerousRouteRows = [
  ['login', 'server/routes/authRoutes.js', ['createDistributedRateLimit', 'securityCritical']],
  ['otp', 'server/routes/otpRoutes.js', ['createDistributedRateLimit', 'requireTurnstile']],
  ['webauthn challenge', 'server/routes/authRoutes.js', ['trustedDeviceVerificationLimiter', 'bootstrapDeviceChallengeLimiter']],
  ['admin mutation', 'server/routes/adminEmergencyControlRoutes.js', ['sensitiveActions.adminSecurityConfigChange']],
  ['payment intent', 'server/routes/paymentRoutes.js', ['paymentIntentRateLimit', 'paymentIntentLimiter']],
  ['refund', 'server/routes/paymentRoutes.js', ['sensitiveActions.paymentRefund', 'paymentIntentLimiter']],
  ['webhook', 'server/controllers/paymentController.js', ['recordPaymentWebhookSecurityAudit']],
  ['order mutation', 'server/routes/orderRoutes.js', ['sensitiveActions.orderStatusChange']],
  ['upload', 'server/routes/uploadRoutes.js', ['sensitiveActions.uploadWrite']],
  ['review upload', 'server/controllers/uploadController.js', ['scanUploadBuffer']],
  ['moderation', 'server/routes/adminFraudRoutes.js', ['sensitiveActions.adminFraudModeration']],
  ['seller/listing mutation', 'server/routes/listingRoutes.js', ['listingMutationRateLimit', 'listingMutationLimiter']],
  ['AI call', 'server/routes/aiRoutes.js', ['aiChatLimiter']],
  ['search-heavy routes', 'server/middleware/queryBudgetGuard.js', ['QUERY_BUDGET_EXCEEDED']],
  ['data export/delete', 'server/routes/adminAnalyticsRoutes.js', ['sensitiveActions.dataExport']],
];

export const buildRateLimitCoverageReport = (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const checks = [
    fileCheck(root, 'docs/security/rate-limit-coverage.md', 'rate.doc'),
    fileCheck(root, 'server/middleware/trafficBudgetPolicy.js', 'rate.runtime'),
    fileCheck(root, 'server/middleware/distributedRateLimit.js', 'rate.runtime'),
  ];

  for (const [name, file, terms] of dangerousRouteRows) {
    const source = readSource(root, file);
    checks.push(check({
      id: `rate.route.${name.replace(/[^a-z0-9]+/gi, '-')}`,
      title: `${name} has rate-limit or replay evidence`,
      status: textIncludesAll(source, terms) ? 'pass' : 'fail',
      scope: 'repo',
      severity: textIncludesAll(source, terms) ? 'info' : 'high',
      summary: textIncludesAll(source, terms)
        ? `${name} has expected limiter/replay evidence in ${file}.`
        : `${name} is missing expected limiter/replay evidence in ${file}.`,
      evidence: { file, terms },
    }));
  }

  return buildReport({
    title: 'Rate Limit Coverage',
    checks,
    options,
    extra: {
      coveredRoutes: dangerousRouteRows.map(([name, file, terms]) => ({ name, file, terms })),
      limitations: [
        'Webhook routes use signature, replay, and idempotency evidence instead of user throttling.',
        'Provider/edge limits remain dashboard-managed and must be verified after deployment changes.',
      ],
    },
  });
};

export const buildBackpressureReadinessReport = (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const checks = [
    fileCheck(root, 'docs/security/backpressure-queue-resilience.md', 'backpressure.doc'),
    fileCheck(root, 'server/services/payments/paymentService.js', 'backpressure.worker'),
    fileCheck(root, 'server/services/email/orderEmailQueueService.js', 'backpressure.worker'),
    fileCheck(root, 'server/services/commerceReconciliationService.js', 'backpressure.worker'),
  ];
  const index = [
    readSource(root, 'server/services/payments/paymentService.js'),
    readSource(root, 'server/services/email/orderEmailQueueService.js'),
    readSource(root, 'server/services/catalogService.js'),
    readSource(root, 'server/services/statusService.js'),
  ].join('\n');
  for (const term of ['retry', 'timeout', 'worker', 'nextAttemptAt', 'limit']) {
    checks.push(check({
      id: `backpressure.term.${term}`,
      title: `Backpressure source contains ${term}`,
      status: index.toLowerCase().includes(term.toLowerCase()) ? 'pass' : 'fail',
      scope: 'repo',
      severity: index.toLowerCase().includes(term.toLowerCase()) ? 'info' : 'medium',
      summary: `Backpressure evidence for ${term}.`,
      evidence: { term },
    }));
  }
  return buildReport({ title: 'Backpressure Readiness', checks, options });
};

export const buildProviderCircuitBreakerReport = (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const providers = [
    ['Stripe', 'server/services/payments/providers/stripeProvider.js'],
    ['Razorpay', 'server/services/payments/providers/razorpayProvider.js'],
    ['Resend', 'server/services/email/providers/resendProvider.js'],
    ['Firebase Admin/Auth', 'server/config/firebase.js'],
    ['MongoDB', 'server/config/db.js'],
    ['Redis', 'server/config/redis.js'],
    ['AI providers', 'server/services/ai/modelGatewayService.js'],
    ['Object storage', 'server/services/reviewMediaStorageService.js'],
    ['LiveKit', 'server/services/livekitService.js'],
  ];
  const checks = [fileCheck(root, 'docs/security/provider-circuit-breakers.md', 'provider.doc')];
  for (const [provider, file] of providers) {
    const source = readSource(root, file);
    const hasTimeout = /timeout|AbortController|ConnectTimeout/i.test(source);
    const hasRetryOrFallback = /retry|fallback|degraded|temporarily|circuit/i.test(source);
    checks.push(check({
      id: `provider.${provider.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: `${provider} provider failure posture is documented or implemented`,
      status: fileExists(root, file) && (hasTimeout || hasRetryOrFallback) ? 'pass' : 'warning',
      scope: 'repo',
      severity: fileExists(root, file) && (hasTimeout || hasRetryOrFallback) ? 'info' : 'medium',
      summary: `${provider}: timeout=${hasTimeout}, retry/fallback=${hasRetryOrFallback}.`,
      evidence: { provider, file, hasTimeout, hasRetryOrFallback },
    }));
  }
  return buildReport({ title: 'Provider Circuit Breaker Readiness', checks, options, extra: { providers: providers.map(([provider, file]) => ({ provider, file })) } });
};

export const buildCacheResilienceReport = (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const checks = [
    fileCheck(root, 'docs/security/cache-resilience.md', 'cache.doc'),
    fileCheck(root, 'server/middleware/cachePolicy.js', 'cache.runtime'),
    fileCheck(root, 'server/performance/cache.js', 'cache.runtime'),
    fileCheck(root, 'server/tests/performanceCache.test.js', 'cache.test'),
  ];
  const cachePolicySource = readSource(root, 'server/middleware/cachePolicy.js');
  for (const term of ['no-store', 'stale-while-revalidate', 'public, max-age']) {
    checks.push(check({
      id: `cache.term.${term.replace(/[^a-z0-9]+/gi, '-')}`,
      title: `Cache policy includes ${term}`,
      status: cachePolicySource.includes(term) ? 'pass' : 'fail',
      scope: 'repo',
      severity: cachePolicySource.includes(term) ? 'info' : 'medium',
      summary: `Cache policy evidence for ${term}.`,
      evidence: { file: 'server/middleware/cachePolicy.js' },
    }));
  }
  return buildReport({ title: 'Cache Resilience', checks, options });
};

export const buildDatabasePressureReport = (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const checks = [
    fileCheck(root, 'docs/security/database-pressure-resilience.md', 'db.doc'),
    fileCheck(root, 'server/middleware/queryBudgetGuard.js', 'db.runtime'),
    fileCheck(root, 'scripts/db/check-index-coverage.mjs', 'db.script'),
  ];
  const source = [
    readSource(root, 'server/services/catalogService.js'),
    readSource(root, 'server/controllers/listingController.js'),
    readSource(root, 'server/middleware/queryBudgetGuard.js'),
  ].join('\n');
  for (const term of ['maxTimeMS', 'limit', 'escapeRegExp', 'QUERY_BUDGET_EXCEEDED']) {
    checks.push(check({
      id: `db.term.${term}`,
      title: `Database pressure evidence includes ${term}`,
      status: source.includes(term) ? 'pass' : 'fail',
      scope: 'repo',
      severity: source.includes(term) ? 'info' : 'high',
      summary: `Database pressure source includes ${term}.`,
      evidence: { term },
    }));
  }
  return buildReport({ title: 'Database Pressure Resilience', checks, options });
};

export const buildTrafficObservabilityReport = (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const checks = [
    fileCheck(root, 'docs/security/traffic-observability-alerting.md', 'observability.doc'),
    fileCheck(root, 'server/metrics/trafficResilienceMetrics.js', 'observability.runtime'),
    fileCheck(root, 'infra/observability/alertmanager/traffic-fortress-rules.yml', 'observability.alerts'),
    fileCheck(root, 'infra/observability/grafana/dashboards/traffic-fortress.json', 'observability.dashboard'),
  ];
  const metricsSource = readSource(root, 'server/metrics/trafficResilienceMetrics.js');
  for (const metric of ['aura_traffic_budget_denied_total', 'aura_traffic_abuse_events_total', 'aura_traffic_load_shedding_state']) {
    checks.push(check({
      id: `observability.metric.${metric}`,
      title: `${metric} is registered`,
      status: metricsSource.includes(metric) ? 'pass' : 'fail',
      scope: 'repo',
      severity: metricsSource.includes(metric) ? 'info' : 'high',
      summary: `${metric} metric registration exists.`,
      evidence: { file: 'server/metrics/trafficResilienceMetrics.js' },
    }));
  }
  return buildReport({ title: 'Traffic Observability Check', checks, options });
};

const isLocalTarget = (targetUrl) => /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(String(targetUrl || ''));
const isProductionLikeTarget = (targetUrl, options = {}) => {
  if (options.production) return true;
  if (!targetUrl) return false;
  return !isLocalTarget(targetUrl) && !options.staging;
};

export const buildSafeTrafficSimulationReport = (options = {}) => {
  const env = options.env || process.env;
  const profile = String(options.profile || env.TRAFFIC_SIMULATION_PROFILE || 'baseline').trim();
  const targetUrl = String(options.targetUrl || env.TRAFFIC_SIMULATION_TARGET_URL || (options.local ? 'http://127.0.0.1:5000' : '')).trim();
  const dryRun = options.dryRun !== false && String(env.TRAFFIC_SIMULATION_DRY_RUN || 'true').trim().toLowerCase() !== 'false';
  const allowProductionReadonly = String(env.TRAFFIC_SIMULATION_ALLOW_PRODUCTION_READONLY || '').trim().toLowerCase() === 'yes';
  const productionLike = isProductionLikeTarget(targetUrl, options);
  const destructive = DESTRUCTIVE_SIMULATION_PROFILES.has(profile);
  const checks = [
    check({
      id: 'simulation.default-dry-run',
      title: 'Traffic simulation defaults to dry-run',
      status: dryRun ? 'pass' : 'fail',
      scope: 'policy',
      severity: dryRun ? 'info' : 'high',
      summary: dryRun ? 'No network requests will be sent.' : 'Simulation would send network requests.',
      evidence: { dryRun },
    }),
    check({
      id: 'simulation.production-refused',
      title: 'Production-like target is refused by default',
      status: productionLike && !allowProductionReadonly ? 'fail' : 'pass',
      scope: 'policy',
      severity: productionLike && !allowProductionReadonly ? 'critical' : 'info',
      summary: productionLike && !allowProductionReadonly
        ? 'Production-like target is refused without explicit read-only approval.'
        : 'Target is local/staging or explicit read-only production approval is present.',
      evidence: { productionLike, allowProductionReadonly },
    }),
    check({
      id: 'simulation.destructive-profile-refused',
      title: 'Destructive/costly abuse profiles are refused',
      status: destructive ? 'fail' : 'pass',
      scope: 'policy',
      severity: destructive ? 'critical' : 'info',
      summary: destructive
        ? `${profile} is not allowed by the safe simulation harness.`
        : `${profile} is a safe dry-run profile.`,
      evidence: { profile },
    }),
    check({
      id: 'simulation.no-secret-output',
      title: 'Simulation report stores route labels only',
      status: 'pass',
      scope: 'repo',
      severity: 'info',
      summary: 'The dry-run plan contains routes, methods, and expected statuses only.',
      evidence: { redaction: 'no headers, cookies, tokens, or request bodies' },
    }),
  ];

  const plannedRequests = [
    { method: 'GET', path: '/health/live', expected: '200 or cached liveness' },
    { method: 'GET', path: '/api/status', expected: '200 or cached status' },
    { method: 'GET', path: '/api/products?limit=20', expected: 'budgeted public search' },
  ];

  return buildReport({
    title: 'Safe Traffic Simulation',
    checks,
    options,
    extra: {
      profile,
      target: targetUrl ? '[configured-target]' : '[not configured]',
      dryRun,
      plannedRequests,
      networkRequestsSent: false,
      limitations: [
        'This harness is dry-run by default and does not perform production load testing.',
        'Real load drills require local or explicitly configured staging targets owned by the team.',
      ],
    },
  });
};

export const buildTrafficResilienceProofReport = (options = {}) => {
  const subreports = {
    matrix: buildTrafficResilienceMatrixReport(options),
    rateLimits: buildRateLimitCoverageReport(options),
    backpressure: buildBackpressureReadinessReport(options),
    providers: buildProviderCircuitBreakerReport(options),
    cache: buildCacheResilienceReport(options),
    database: buildDatabasePressureReport(options),
    observability: buildTrafficObservabilityReport(options),
    simulation: buildSafeTrafficSimulationReport({ ...options, dryRun: true, profile: 'baseline' }),
  };
  const checks = Object.entries(subreports).map(([name, report]) => check({
    id: `traffic.proof.${name}`,
    title: `${name} subreport passes`,
    status: report.status === 'pass' ? 'pass' : 'fail',
    scope: 'repo',
    severity: report.status === 'pass' ? 'info' : 'high',
    summary: `${name} status is ${report.status}.`,
    evidence: { summary: report.summary },
  }));
  const report = buildReport({
    title: 'Traffic Resilience Proof',
    checks,
    options,
    extra: {
      subreports,
      trafficResilienceScore: Math.round(Object.values(subreports).reduce((sum, item) => (
        sum + (item.status === 'pass' ? 100 : 60)
      ), 0) / Object.keys(subreports).length),
      limitations: [
        'No app-only proof can guarantee survival of unlimited volumetric attacks.',
        'Edge/CDN/WAF/provider absorption and origin lockdown are required for massive attack traffic.',
      ],
    },
  });
  return report;
};

export const renderMatrixSections = (rows = TRAFFIC_MATRIX_ROWS) => [
  '## Matrix',
  '',
  markdownTable(
    ['ID', 'Category', 'Owner', 'Status', 'Evidence', 'Test', 'Rollback', 'Toggle', 'Failure Mode', 'Alert'],
    rows.map((row) => [
      row.id,
      row.category,
      row.owner,
      row.status,
      row.evidenceFile,
      row.testFile,
      row.rollback,
      row.productionToggle,
      row.failureMode,
      row.alert,
    ]),
  ),
];

export const renderSimulationSections = (report) => [
  '## Plan',
  '',
  `- Profile: ${report.profile}`,
  `- Target: ${report.target}`,
  `- Dry run: ${report.dryRun}`,
  `- Network requests sent: ${report.networkRequestsSent}`,
  '',
  markdownTable(
    ['Method', 'Path', 'Expected'],
    report.plannedRequests.map((entry) => [entry.method, entry.path, entry.expected]),
  ),
  '',
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
];

export const renderTrafficProofSections = (report) => [
  '## Subreports',
  '',
  markdownTable(
    ['Name', 'Status', 'Pass', 'Warning', 'Fail', 'Skipped'],
    Object.entries(report.subreports).map(([name, subreport]) => [
      name,
      subreport.status,
      subreport.summary.pass,
      subreport.summary.warning,
      subreport.summary.fail,
      subreport.summary.skipped,
    ]),
  ),
  '',
  `Traffic resilience score: ${report.trafficResilienceScore}%`,
  '',
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
];

