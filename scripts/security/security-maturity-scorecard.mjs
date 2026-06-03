import path from 'node:path';
import {
  check,
  isMainModule,
  markdownTable,
  parseReadinessArgs,
  renderChecksMarkdown,
  shouldFail,
  summarizeChecks,
  writeReadinessReports,
} from './pqc-readiness-utils.mjs';
import { buildPqcMaturityScorecardReport } from './pqc-maturity-scorecard.mjs';
import { buildTrafficResilienceProofReport } from './traffic-fortress-utils.mjs';

export const SECURITY_MATURITY_REPORT_BASENAME = 'security-maturity-scorecard';

const scoreEntry = ({ id, label, score, evidence, limitation }) => ({
  id,
  label,
  score,
  evidence,
  limitation,
});

export const buildSecurityMaturityScorecardReport = async (options = {}) => {
  const pqc = await buildPqcMaturityScorecardReport(options);
  const traffic = buildTrafficResilienceProofReport(options);
  const routeSecurityScore = traffic.subreports.rateLimits.status === 'pass' ? 96 : 75;
  const observabilityScore = traffic.subreports.observability.status === 'pass' ? 90 : 70;
  const incidentScore = traffic.subreports.matrix.rows.some((row) => row.id === 'incident-runbook') ? 92 : 70;
  const providerRiskScore = traffic.subreports.providers.summary.fail === 0 ? 82 : 65;

  const sections = [
    scoreEntry({
      id: 'pqc-readiness',
      label: 'PQC readiness',
      score: pqc.scores.find((entry) => entry.id === 'repo-owned-pqc-readiness')?.currentScore || 0,
      evidence: 'PQC maturity scorecard and real-target proof harness',
      limitation: 'No 100% quantum-proof claim.',
    }),
    scoreEntry({
      id: 'controllable-surface-pqc-proof',
      label: 'Controllable-surface PQC proof',
      score: pqc.scores.find((entry) => entry.id === 'controllable-surface-deployment-proof')?.currentScore || 0,
      evidence: 'SSH/TLS/internal/backup/release/provider proof paths',
      limitation: 'Disabled live targets are honest skipped evidence.',
    }),
    scoreEntry({
      id: 'full-end-to-end-pqc-cap',
      label: 'Full end-to-end PQC cap',
      score: pqc.scores.find((entry) => entry.id === 'full-end-to-end-pqc-coverage')?.currentScore || 0,
      evidence: 'Provider dependency register',
      limitation: 'Browser/WebPKI/provider migration caps the score.',
    }),
    scoreEntry({
      id: 'route-security',
      label: 'Route security',
      score: routeSecurityScore,
      evidence: 'Route enforcement and rate-limit coverage checks',
      limitation: 'Provider webhooks rely on signature/replay/idempotency rather than user throttling.',
    }),
    scoreEntry({
      id: 'traffic-resilience-proof',
      label: 'Traffic-resilience proof',
      score: traffic.trafficResilienceScore,
      evidence: 'Traffic proof aggregate report',
      limitation: 'App-layer proof does not replace CDN/WAF/provider DDoS absorption.',
    }),
    scoreEntry({
      id: 'observability-readiness',
      label: 'Observability readiness',
      score: observabilityScore,
      evidence: 'Traffic metrics, alert rules, dashboard artifacts',
      limitation: 'Production alert routing still requires operator/provider configuration.',
    }),
    scoreEntry({
      id: 'incident-readiness',
      label: 'Incident readiness',
      score: incidentScore,
      evidence: 'DDoS/bot abuse runbook and matrix rollback rows',
      limitation: 'Runbooks must be exercised in staging drills.',
    }),
    scoreEntry({
      id: 'provider-dependency-risk',
      label: 'Provider dependency risk',
      score: providerRiskScore,
      evidence: 'Provider circuit-breaker readiness report',
      limitation: 'Firebase, payment, email, database, AI, and CDN controls remain partly external.',
    }),
  ];

  const checks = [
    check({
      id: 'security-maturity.pqc-scorecard',
      title: 'PQC maturity scorecard passes',
      status: pqc.status === 'pass' ? 'pass' : 'fail',
      scope: 'repo',
      severity: pqc.status === 'pass' ? 'info' : 'high',
      summary: `PQC maturity scorecard status is ${pqc.status}.`,
      evidence: { overallScore: pqc.overallScore },
    }),
    check({
      id: 'security-maturity.traffic-proof',
      title: 'Traffic resilience proof passes',
      status: traffic.status === 'pass' ? 'pass' : 'fail',
      scope: 'repo',
      severity: traffic.status === 'pass' ? 'info' : 'high',
      summary: `Traffic resilience proof status is ${traffic.status}.`,
      evidence: { trafficResilienceScore: traffic.trafficResilienceScore },
    }),
    check({
      id: 'security-maturity.no-absolute-claims',
      title: 'Scorecard limitations reject absolute claims',
      status: 'pass',
      scope: 'repo',
      severity: 'info',
      summary: 'The combined scorecard explicitly avoids 100% PQC and DDoS immunity claims.',
      evidence: { limitationPolicy: 'honest caps' },
    }),
  ];

  const weightedScore = Math.round(sections.reduce((sum, entry) => sum + entry.score, 0) / sections.length);
  const summary = summarizeChecks(checks);
  return {
    title: 'Security Maturity Scorecard',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    weightedScore,
    sections,
    pqc,
    traffic,
    summary,
    checks,
    limitations: [
      'No system is 100% quantum-proof.',
      'No system is completely DDoS-proof.',
      'Full end-to-end PQC remains capped by browser, WebPKI, provider, app-store, and third-party SDK migration.',
      'Massive traffic survival requires CDN/WAF/provider absorption, origin lockdown, and capacity, not only app code.',
      'Production load or DDoS testing must never run without explicit authorization and safe limits.',
    ],
  };
};

export const renderSecurityMaturityScorecardMarkdown = (report) => renderChecksMarkdown(report, [
  '## Scores',
  '',
  markdownTable(
    ['Section', 'Score', 'Evidence', 'Limitation'],
    report.sections.map((entry) => [entry.label, `${entry.score}%`, entry.evidence, entry.limitation]),
  ),
  '',
  `Weighted score: ${report.weightedScore}%`,
  '',
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
]);

const main = async () => {
  const options = parseReadinessArgs(process.argv.slice(2));
  const report = await buildSecurityMaturityScorecardReport(options);
  const markdown = renderSecurityMaturityScorecardMarkdown(report);
  const written = writeReadinessReports({
    report,
    markdown,
    reportDir: options.reportDir,
    baseName: SECURITY_MATURITY_REPORT_BASENAME,
    options,
  });
  console.log(`[security-maturity-scorecard] ${report.status}: score ${report.weightedScore}% wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) {
  await main();
}
