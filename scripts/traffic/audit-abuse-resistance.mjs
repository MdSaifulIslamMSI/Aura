import path from 'node:path';
import {
  buildTrafficAuditReport,
  checkFail,
  checkPass,
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
  if (policy.methodGroup === 'mutation') {
    const hasAuthorityProof = policy.authRequired
      || policy.adminRequired
      || policy.signatureRequired
      || policy.flowProtectionRequired
      || policy.quotaRequired;
    checks.push((hasAuthorityProof ? checkPass : checkFail)({
      id: `abuse.mutation-authority.${policy.id}`,
      title: `${policy.id} mutation has authority or abuse proof`,
      summary: hasAuthorityProof
        ? `${policy.id} declares auth, signature, flow, admin, or quota control.`
        : `${policy.id} is a public mutation without authority or abuse proof.`,
      evidence: {
        authRequired: policy.authRequired,
        adminRequired: policy.adminRequired,
        signatureRequired: policy.signatureRequired,
        flowProtectionRequired: policy.flowProtectionRequired,
        quotaRequired: policy.quotaRequired,
      },
    }));
  }

  if (['AUTH_LOGIN', 'AUTH_WEBAUTHN', 'OTP', 'OTP_RESET'].includes(policy.routeClass)) {
    checks.push((policy.failMode === 'fail-closed' && policy.perIpLimit <= 60 ? checkPass : checkFail)({
      id: `abuse.auth-strict.${policy.id}`,
      title: `${policy.id} auth/OTP/reset policy is strict`,
      summary: `${policy.id}: failMode=${policy.failMode}, perIp=${policy.perIpLimit}.`,
      evidence: { failMode: policy.failMode, perIpLimit: policy.perIpLimit },
    }));
  }

  if (policy.profile === PROFILES.PAYMENT_CHECKOUT && policy.methodGroup !== 'read') {
    checks.push((policy.idempotencyRequired ? checkPass : checkFail)({
      id: `abuse.payment-idempotency.${policy.id}`,
      title: `${policy.id} payment/order mutation has idempotency decision`,
      summary: policy.idempotencyDecision || `${policy.id} lacks idempotency decision.`,
      evidence: { idempotencyRequired: policy.idempotencyRequired, idempotencyDecision: policy.idempotencyDecision },
    }));
  }

  if (policy.profile === PROFILES.UPLOAD_MEDIA) {
    checks.push((policy.bodySizeBytes > 0 && policy.fileValidationRequired ? checkPass : checkFail)({
      id: `abuse.upload.${policy.id}`,
      title: `${policy.id} upload is bounded and validated`,
      summary: `${policy.id}: body=${policy.bodySizeBytes}, validation=${policy.fileValidationRequired}.`,
      evidence: { bodySizeBytes: policy.bodySizeBytes, guardEvidence: policy.guardEvidence },
    }));
  }

  if (policy.profile === PROFILES.AI_GATEWAY) {
    checks.push((policy.quotaRequired && policy.concurrencyCapRequired ? checkPass : checkFail)({
      id: `abuse.ai-quota.${policy.id}`,
      title: `${policy.id} AI route has quota and concurrency posture`,
      summary: `${policy.id}: quota=${policy.quotaRequired}, concurrency=${policy.concurrencyCapRequired}.`,
      evidence: { quotaRequired: policy.quotaRequired, concurrencyCap: policy.concurrencyCap },
    }));
  }

  if (policy.profile === PROFILES.ADMIN_PRIVILEGED) {
    checks.push((policy.adminRequired && policy.guardEvidence ? checkPass : checkFail)({
      id: `abuse.admin-guard.${policy.id}`,
      title: `${policy.id} admin route has privileged guard`,
      summary: policy.guardEvidence || `${policy.id} lacks privileged guard evidence.`,
      evidence: { adminRequired: policy.adminRequired, guardEvidence: policy.guardEvidence },
    }));
  }

  if (policy.profile === PROFILES.WEBHOOK_INTERNAL && policy.id.includes('webhook')) {
    checks.push((policy.signatureRequired && policy.idempotencyRequired ? checkPass : checkFail)({
      id: `abuse.webhook-signature.${policy.id}`,
      title: `${policy.id} webhook has signature and replay/idempotency posture`,
      summary: `${policy.id}: signature=${policy.signatureRequired}, idempotency=${policy.idempotencyRequired}.`,
      evidence: { signatureRequired: policy.signatureRequired, idempotencyRequired: policy.idempotencyRequired },
    }));
  }

  if (policy.profile === PROFILES.LIVE_SOCKET) {
    checks.push((policy.authRequired && policy.concurrencyCapRequired && policy.guardEvidence ? checkPass : checkFail)({
      id: `abuse.socket-proof.${policy.id}`,
      title: `${policy.id} socket/live token path has ownership/session proof`,
      summary: policy.guardEvidence || `${policy.id} lacks live session proof.`,
      evidence: { authRequired: policy.authRequired, concurrencyCap: policy.concurrencyCap, guardEvidence: policy.guardEvidence },
    }));
  }

  checks.push((policy.costClass && policy.timeoutMs && policy.observabilityTags?.component ? checkPass : checkFail)({
    id: `abuse.common-budget.${policy.id}`,
    title: `${policy.id} has cost, timeout, and observability tags`,
    summary: `${policy.id}: cost=${policy.costClass}, timeout=${policy.timeoutMs}, tag=${policy.observabilityTags?.component || ''}.`,
    evidence: { costClass: policy.costClass, timeoutMs: policy.timeoutMs, observabilityTags: policy.observabilityTags },
  }));
}

const report = buildTrafficAuditReport({
  title: 'Abuse Resistance Audit',
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
  '- Failures identify routes that are too loose for abuse resistance.',
  '- Auth, payment, admin, upload, AI, webhook, and socket checks are merge blockers.',
]);
const written = writeTrafficAuditOutputs({
  report,
  markdown,
  options,
  baseName: 'abuse-resistance-audit',
  docsRelativePath: path.join('docs', 'traffic', 'abuse-resistance-audit.md'),
});

console.log(`[traffic:audit:abuse] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
if (report.status === 'fail') process.exit(1);
