import path from 'node:path';
import {
  buildTrafficAuditReport,
  checkFail,
  checkPass,
  checkWarn,
  loadTrafficRegistry,
  parseTrafficAuditArgs,
  renderPolicySummaryTable,
  renderTrafficAuditMarkdown,
  writeTrafficAuditOutputs,
} from './traffic-audit-utils.mjs';

const options = parseTrafficAuditArgs(process.argv.slice(2));
const { PROFILES, listTrafficPolicies } = loadTrafficRegistry(options.root);
const policies = listTrafficPolicies();
const checks = [];

for (const policy of policies) {
  if (policy.profile === PROFILES.PUBLIC_BROWSING && policy.methodGroup !== 'mutation') {
    const smooth = policy.perIpLimit >= 100 || policy.routeClass === 'STATIC_PUBLIC';
    checks.push((smooth ? checkPass : checkWarn)({
      id: `smooth.public.${policy.id}`,
      title: `${policy.id} public read allowance is smooth`,
      summary: smooth
        ? `${policy.id} allows ${policy.perIpLimit}/${policy.sustainedWindow.seconds}s per IP.`
        : `${policy.id} may be too strict for normal browsing.`,
      evidence: { perIpLimit: policy.perIpLimit, windowSeconds: policy.sustainedWindow.seconds },
    }));
  }

  if (policy.profile === PROFILES.AUTH_SECURITY && ['AUTH_LOGIN', 'AUTH_WEBAUTHN', 'OTP', 'OTP_RESET'].includes(policy.routeClass)) {
    checks.push((policy.flowProtectionRequired ? checkPass : checkFail)({
      id: `smooth.auth-flow.${policy.id}`,
      title: `${policy.id} has per-flow or challenge protection`,
      summary: policy.flowProtectionRequired
        ? `${policy.id} declares flow/challenge protection.`
        : `${policy.id} is auth-sensitive but lacks flow/challenge protection.`,
      evidence: { routeClass: policy.routeClass, routeLevelLimiterEvidence: policy.routeLevelLimiterEvidence },
    }));
  }

  if (policy.profile === PROFILES.PUBLIC_BROWSING && policy.cacheRule === 'no-store' && policy.perIpLimit < 300) {
    checks.push(checkWarn({
      id: `smooth.public-cache.${policy.id}`,
      title: `${policy.id} public route may overuse origin`,
      summary: 'Public browsing route is no-store with a low per-IP allowance.',
      evidence: { cacheRule: policy.cacheRule, perIpLimit: policy.perIpLimit },
    }));
  }

  if (policy.profile === PROFILES.AI_GATEWAY || policy.profile === PROFILES.LIVE_SOCKET) {
    checks.push((policy.concurrencyCapRequired && policy.concurrencyCap ? checkPass : checkFail)({
      id: `smooth.concurrency.${policy.id}`,
      title: `${policy.id} has concurrency/cost cap`,
      summary: policy.concurrencyCap || `${policy.id} is expensive but lacks a concurrency/cost cap.`,
      evidence: { concurrencyCapRequired: policy.concurrencyCapRequired, concurrencyCap: policy.concurrencyCap },
    }));
  }

  const retryIsExplicitlyBounded = /^No (?:automatic|blind)/i.test(policy.retryPolicy)
    || policy.quotaRequired
    || policy.fileValidationRequired
    || policy.signatureRequired
    || policy.flowProtectionRequired;
  if (policy.methodGroup === 'mutation' && /retry/i.test(policy.retryPolicy) && !retryIsExplicitlyBounded && !policy.idempotencyRequired) {
    checks.push(checkFail({
      id: `smooth.retry-idempotency.${policy.id}`,
      title: `${policy.id} mutation retry requires idempotency`,
      summary: `${policy.id} allows retry semantics without an idempotency decision.`,
      evidence: { retryPolicy: policy.retryPolicy, idempotencyDecision: policy.idempotencyDecision },
    }));
  }

  if (policy.profile === PROFILES.UPLOAD_MEDIA) {
    checks.push((policy.bodySizeBytes > 0 && policy.fileValidationRequired ? checkPass : checkFail)({
      id: `smooth.upload.${policy.id}`,
      title: `${policy.id} upload body and validation budget exists`,
      summary: policy.fileValidationRequired
        ? `${policy.id} has body-size and file-validation evidence.`
        : `${policy.id} lacks upload validation evidence.`,
      evidence: { bodySizeBytes: policy.bodySizeBytes, guardEvidence: policy.guardEvidence },
    }));
  }

  if (policy.profile === PROFILES.ADMIN_PRIVILEGED) {
    checks.push((policy.adminRequired && policy.perIpLimit <= 80 && policy.failMode === 'fail-closed' ? checkPass : checkFail)({
      id: `smooth.admin.${policy.id}`,
      title: `${policy.id} admin budget is strict`,
      summary: `${policy.id}: adminRequired=${policy.adminRequired}, perIp=${policy.perIpLimit}, failMode=${policy.failMode}.`,
      evidence: { adminRequired: policy.adminRequired, perIpLimit: policy.perIpLimit, failMode: policy.failMode },
    }));
  }

  if (policy.profile === PROFILES.WEBHOOK_INTERNAL && policy.id.includes('webhook')) {
    checks.push((policy.signatureRequired && !policy.cacheRule.includes('public') ? checkPass : checkFail)({
      id: `smooth.webhook.${policy.id}`,
      title: `${policy.id} avoids generic public webhook treatment`,
      summary: policy.signatureRequired
        ? `${policy.id} declares signature/replay posture.`
        : `${policy.id} lacks webhook signature posture.`,
      evidence: { signatureRequired: policy.signatureRequired, cacheRule: policy.cacheRule },
    }));
  }

  if (policy.profile === PROFILES.OBSERVABILITY && policy.routeClass === 'HEALTH') {
    checks.push((policy.timeoutMs <= 3000 && policy.bodySizeBytes <= 8192 ? checkPass : checkWarn)({
      id: `smooth.health.${policy.id}`,
      title: `${policy.id} health checks stay cheap`,
      summary: `${policy.id}: timeout=${policy.timeoutMs}ms, body=${policy.bodySizeBytes}.`,
      evidence: { timeoutMs: policy.timeoutMs, bodySizeBytes: policy.bodySizeBytes },
    }));
  }

  if ((policy.authRequired || policy.adminRequired) && policy.cacheRule !== 'no-store') {
    checks.push(checkFail({
      id: `smooth.private-cache.${policy.id}`,
      title: `${policy.id} private route must not be cacheable`,
      summary: `${policy.id} is private but declares cache rule ${policy.cacheRule}.`,
      evidence: { cacheRule: policy.cacheRule },
    }));
  }
}

const limitGroups = new Map();
for (const policy of policies) {
  const key = [policy.perIpLimit, policy.perUserLimit, policy.perDeviceSessionLimit, policy.bodySizeBytes, policy.timeoutMs].join(':');
  const group = limitGroups.get(key) || [];
  group.push(policy);
  limitGroups.set(key, group);
}
for (const [key, group] of limitGroups.entries()) {
  const components = new Set(group.map((policy) => policy.componentName));
  if (components.size >= 4) {
    checks.push(checkWarn({
      id: `smooth.identical-limits.${key.replace(/[^a-z0-9]+/gi, '-')}`,
      title: 'Identical limits span many components',
      summary: `${group.length} policies share identical limit shape across ${components.size} components.`,
      evidence: { policies: group.map((policy) => policy.id) },
    }));
  }
}

const report = buildTrafficAuditReport({
  title: 'Rate Limit Smoothness Audit',
  checks,
  options,
  extra: { policies: policies.map((policy) => policy.id) },
});
const markdown = renderTrafficAuditMarkdown(report, [
  '## Policy Summary',
  '',
  renderPolicySummaryTable(policies),
  '',
  '## Output Contract',
  '',
  '- Warnings identify UX smoothness risks without weakening blockers.',
  '- Failures indicate policy gaps that should block merge.',
]);
const written = writeTrafficAuditOutputs({
  report,
  markdown,
  options,
  baseName: 'rate-limit-smoothness-audit',
  docsRelativePath: path.join('docs', 'traffic', 'rate-limit-smoothness-audit.md'),
});

console.log(`[traffic:audit:smoothness] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
if (report.status === 'fail') process.exit(1);
