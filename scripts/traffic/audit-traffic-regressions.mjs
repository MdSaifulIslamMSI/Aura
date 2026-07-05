import path from 'node:path';
import {
  buildTrafficAuditReport,
  checkFail,
  checkPass,
  extractExpressMounts,
  loadTrafficRegistry,
  mountHasExplicitPolicy,
  parseTrafficAuditArgs,
  readRepoText,
  renderTrafficAuditMarkdown,
  writeTrafficAuditOutputs,
} from './traffic-audit-utils.mjs';
import { existsSync } from 'node:fs';

const options = parseTrafficAuditArgs(process.argv.slice(2));
const { PROFILES, listTrafficPolicies } = loadTrafficRegistry(options.root);
const policies = listTrafficPolicies();
const mounts = extractExpressMounts(options.root);
const checks = [];

for (const mount of mounts) {
  checks.push((mountHasExplicitPolicy(mount, policies) ? checkPass : checkFail)({
    id: `regression.mount.${mount.replace(/[^a-z0-9]+/gi, '-')}`,
    title: `${mount} has explicit traffic policy`,
    summary: mountHasExplicitPolicy(mount, policies)
      ? `${mount} is covered by a component policy.`
      : `${mount} is covered only by fallback or not covered.`,
    evidence: { mount },
  }));
}

for (const policy of policies) {
  if (policy.bodyAccepted) {
    checks.push((policy.bodySizeBytes > 0 ? checkPass : checkFail)({
      id: `regression.body.${policy.id}`,
      title: `${policy.id} body-accepting route has body budget`,
      summary: `${policy.id}: bodyAccepted=${policy.bodyAccepted}, bodySizeBytes=${policy.bodySizeBytes}.`,
      evidence: { bodyAccepted: policy.bodyAccepted, bodySizeBytes: policy.bodySizeBytes },
    }));
  }

  if (['critical', 'high'].includes(policy.costClass) || policy.profile === PROFILES.AI_GATEWAY) {
    checks.push((policy.costClass && policy.routeClass ? checkPass : checkFail)({
      id: `regression.cost.${policy.id}`,
      title: `${policy.id} expensive route has cost class`,
      summary: `${policy.id}: cost=${policy.costClass}, routeClass=${policy.routeClass}.`,
      evidence: { costClass: policy.costClass, routeClass: policy.routeClass },
    }));
  }

  if (policy.methodGroup === 'mutation') {
    const hasDecision = policy.idempotencyRequired
      || /^No (?:automatic|blind)/i.test(policy.retryPolicy)
      || policy.signatureRequired
      || policy.flowProtectionRequired
      || policy.quotaRequired
      || policy.fileValidationRequired;
    checks.push((hasDecision ? checkPass : checkFail)({
      id: `regression.mutation-decision.${policy.id}`,
      title: `${policy.id} mutation has idempotency/rate-limit decision`,
      summary: hasDecision
        ? `${policy.id} has explicit mutation retry/idempotency/proof posture.`
        : `${policy.id} lacks mutation retry/idempotency/proof posture.`,
      evidence: {
        idempotencyRequired: policy.idempotencyRequired,
        retryPolicy: policy.retryPolicy,
        signatureRequired: policy.signatureRequired,
        flowProtectionRequired: policy.flowProtectionRequired,
        quotaRequired: policy.quotaRequired,
      },
    }));
  }

  if (['AUTH_LOGIN', 'AUTH_WEBAUTHN', 'OTP', 'OTP_RESET'].includes(policy.routeClass)) {
    const strictEnough = policy.perIpLimit <= 60 && policy.failMode === 'fail-closed';
    checks.push((strictEnough ? checkPass : checkFail)({
      id: `regression.auth-weakened.${policy.id}`,
      title: `${policy.id} auth route is not weakened`,
      summary: `${policy.id}: perIp=${policy.perIpLimit}, failMode=${policy.failMode}.`,
      evidence: { perIpLimit: policy.perIpLimit, failMode: policy.failMode },
    }));
  }

  if (policy.pathPrefixes.some((prefix) => prefix.startsWith('/api/admin'))) {
    checks.push((policy.profile === PROFILES.ADMIN_PRIVILEGED ? checkPass : checkFail)({
      id: `regression.admin-profile.${policy.id}`,
      title: `${policy.id} admin route stays privileged`,
      summary: `${policy.id}: profile=${policy.profileLabel}.`,
      evidence: { profile: policy.profile, routeClass: policy.routeClass },
    }));
  }

  if (policy.costClass === 'critical') {
    checks.push((policy.failMode === 'fail-closed' ? checkPass : checkFail)({
      id: `regression.fail-closed.${policy.id}`,
      title: `${policy.id} production limiter cannot fail open`,
      summary: `${policy.id}: failMode=${policy.failMode}.`,
      evidence: { failMode: policy.failMode, costClass: policy.costClass },
    }));
  }
}

const fallbackSource = [
  readRepoText(options.root, path.join('scripts', 'scan-prod-fallbacks.mjs')),
  readRepoText(options.root, path.join('scripts', 'smoke', 'assert-no-staging-prod-fallbacks.mjs')),
].join('\n');
const fallbackScannerFiles = [
  path.join('scripts', 'scan-prod-fallbacks.mjs'),
  path.join('scripts', 'smoke', 'assert-no-staging-prod-fallbacks.mjs'),
];
const fallbackScannersPresent = fallbackScannerFiles.every((file) => existsSync(path.join(options.root, file)))
  && fallbackSource.includes('scanTextForProdFallbacks')
  && fallbackSource.includes('scanNoStagingProdFallbacks');
checks.push((fallbackScannersPresent ? checkPass : checkFail)({
  id: 'regression.environment-fallback-scan',
  title: 'Environment fallback scanner remains present',
  summary: fallbackScannersPresent ? 'Existing environment fallback scanners are still wired.' : 'Fallback scanner source could not be found.',
  evidence: { files: ['scripts/scan-prod-fallbacks.mjs', 'scripts/smoke/assert-no-staging-prod-fallbacks.mjs'] },
}));

const report = buildTrafficAuditReport({
  title: 'Traffic Regression Audit',
  checks,
  options,
  extra: { mounts, policies: policies.map((policy) => policy.id) },
});
const markdown = renderTrafficAuditMarkdown(report, [
  '## Covered Express Mounts',
  '',
  ...mounts.map((mount) => `- ${mount}`),
  '',
  '## Regression Contract',
  '',
  '- New top-level API mounts must receive explicit component policy coverage.',
  '- Fallback policies are runtime safety nets, not merge-ready coverage.',
]);
const written = writeTrafficAuditOutputs({
  report,
  markdown,
  options,
  baseName: 'traffic-regression-audit',
});

console.log(`[traffic:audit:regressions] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
if (report.status === 'fail') process.exit(1);
