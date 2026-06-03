import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  check,
  defaultRepoRoot,
  isMainModule,
  markdownTable,
  parseReadinessArgs,
  readTextIfExists,
  renderChecksMarkdown,
  repoPath,
  shouldFail,
  summarizeChecks,
  writeReadinessReports,
} from './pqc-readiness-utils.mjs';
import {
  buildSshPqcEnvironmentProofReport,
  buildSshPqcReadinessReport,
} from './check-ssh-pqc-readiness.mjs';
import { buildTlsConfigReadinessReport } from './tls-config-readiness.mjs';
import { buildTlsEndpointPqcReadinessReport } from './tls-endpoint-pqc-readiness.mjs';
import {
  buildPqcLabBenchmarkReport,
  buildPqcLabSmokeReport,
} from './pqc-lab-smoke.mjs';
import {
  buildInternalServiceEncryptionEvidenceReport,
  buildInternalServiceEncryptionReport,
} from './internal-service-encryption-check.mjs';
import {
  buildBackupCryptoAgilityReport,
  buildBackupPqcEncryptionEvidenceReport,
} from './backup-crypto-agility-check.mjs';
import { buildReleaseSigningReadinessReport } from './release-signing-readiness-check.mjs';
import { buildPqcProviderRegisterReport } from './pqc-provider-register-check.mjs';

export const PQC_MATURITY_SCORECARD_REPORT_BASENAME = 'pqc-maturity-scorecard';

const requiredRepoArtifacts = [
  'scripts/security/pqc-deployment-proof.mjs',
  'scripts/security/check-ssh-pqc-readiness.mjs',
  'scripts/security/tls-endpoint-pqc-readiness.mjs',
  'scripts/security/internal-service-encryption-check.mjs',
  'scripts/security/backup-crypto-agility-check.mjs',
  'scripts/security/release-signing-readiness-check.mjs',
  'scripts/security/pqc-provider-register-check.mjs',
  'scripts/security/pqc-lab-smoke.mjs',
  'docs/security/pqc-maturity-scorecard.md',
  'docs/security/pqc-provider-dependency-register.md',
  'docs/security/pqc-controlled-surface-matrix.md',
];

const reportPassed = (report) => report?.status === 'pass';

const countConfiguredEvidence = (reports) => reports.filter((report) => {
  if (!report) return false;
  if (Object.prototype.hasOwnProperty.call(report, 'mode')) {
    return !/disabled|skip|skipped/i.test(report.mode);
  }
  if (report.benchmark) return Boolean(report.benchmark.attempted);
  return false;
}).length;

const scoreEntry = ({
  id,
  label,
  previousRange,
  currentScore,
  targetRange,
  evidence,
  note,
}) => ({
  id,
  label,
  previousRange,
  currentScore,
  targetRange,
  evidence,
  note,
});

export const buildPqcMaturityScorecardReport = async (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const checks = [];

  for (const artifact of requiredRepoArtifacts) {
    const exists = existsSync(repoPath(root, artifact));
    checks.push(check({
      id: `scorecard.artifact.${artifact}`,
      title: `${artifact} exists`,
      status: exists ? 'pass' : 'fail',
      scope: 'repo',
      severity: exists ? 'info' : 'high',
      summary: exists ? `${artifact} exists.` : `${artifact} is missing.`,
      evidence: { file: artifact },
    }));
  }

  const postQuantumReadiness = readTextIfExists(repoPath(root, 'docs/security/post-quantum-readiness.md'));
  checks.push(check({
    id: 'scorecard.no-100-percent-claim',
    title: 'PQC readiness docs avoid absolute quantum-proof claims',
    status: /not 100% quantum-proof|No app can be 100% secure/i.test(postQuantumReadiness) ? 'pass' : 'fail',
    scope: 'repo',
    severity: /not 100% quantum-proof|No app can be 100% secure/i.test(postQuantumReadiness) ? 'info' : 'high',
    summary: /not 100% quantum-proof|No app can be 100% secure/i.test(postQuantumReadiness)
      ? 'Readiness docs explicitly avoid absolute quantum-proof claims.'
      : 'Readiness docs must explicitly avoid absolute quantum-proof claims.',
    evidence: { file: 'docs/security/post-quantum-readiness.md' },
  }));

  const subreports = {
    sshReadiness: buildSshPqcReadinessReport(options),
    sshEnvironment: buildSshPqcEnvironmentProofReport(options),
    tlsConfig: buildTlsConfigReadinessReport(options),
    tlsEndpoint: await buildTlsEndpointPqcReadinessReport(options),
    labSmoke: buildPqcLabSmokeReport(options),
    labBenchmark: buildPqcLabBenchmarkReport(options),
    internalServices: buildInternalServiceEncryptionReport(options),
    internalEvidence: buildInternalServiceEncryptionEvidenceReport(options),
    backups: await buildBackupCryptoAgilityReport(options),
    backupEvidence: await buildBackupPqcEncryptionEvidenceReport(options),
    releaseSigning: buildReleaseSigningReadinessReport(options),
    providerRegister: buildPqcProviderRegisterReport(options),
  };

  for (const [name, report] of Object.entries(subreports)) {
    checks.push(check({
      id: `scorecard.subreport.${name}`,
      title: `${name} scorecard input report passes`,
      status: reportPassed(report) ? 'pass' : 'fail',
      scope: 'repo',
      severity: reportPassed(report) ? 'info' : 'high',
      summary: `${name} input report status is ${report.status}.`,
      evidence: { summary: report.summary },
    }));
  }

  const workflowText = [
    readTextIfExists(repoPath(root, '.github/workflows/post-quantum-security.yml')),
    readTextIfExists(repoPath(root, '.github/workflows/security-gates.yml')),
  ].join('\n');
  const ciHasProof = /security:pqc:proof:strict/.test(workflowText);
  const ciHasScorecard = /security:pqc:scorecard:strict/.test(workflowText);
  const ciHasProviderRegister = /security:pqc:provider-register/.test(workflowText);
  checks.push(check({
    id: 'scorecard.ci-enforces-proof-scorecard-provider-register',
    title: 'CI runs strict PQC proof, scorecard, and provider register checks',
    status: ciHasProof && ciHasScorecard && ciHasProviderRegister ? 'pass' : 'fail',
    scope: 'repo',
    severity: ciHasProof && ciHasScorecard && ciHasProviderRegister ? 'info' : 'high',
    summary: ciHasProof && ciHasScorecard && ciHasProviderRegister
      ? 'CI includes strict aggregate proof, scorecard, and provider register checks.'
      : 'CI is missing one or more PQC evidence gates.',
    evidence: {
      proof: ciHasProof,
      scorecard: ciHasScorecard,
      providerRegister: ciHasProviderRegister,
    },
  }));

  const evidenceReports = [
    subreports.sshEnvironment,
    subreports.tlsEndpoint,
    subreports.internalEvidence,
    subreports.backupEvidence,
    subreports.labBenchmark,
  ];
  const configuredEvidenceCount = countConfiguredEvidence(evidenceReports);
  const providerUnknownCount = subreports.providerRegister.providerUnknownCount || 0;
  const repoInputsPass = Object.values(subreports).every(reportPassed);
  const ciInputsPass = ciHasProof && ciHasScorecard && ciHasProviderRegister;
  const controlledSurfaceScore = Math.min(85, 76 + (configuredEvidenceCount * 2));
  const fullEndToEndScore = providerUnknownCount > 0 ? 50 : 72;

  const scores = [
    scoreEntry({
      id: 'repo-owned-pqc-readiness',
      label: 'Repo-owned PQC readiness',
      previousRange: '90-95%',
      currentScore: repoInputsPass ? 96 : 82,
      targetRange: '95-98%',
      evidence: 'Policy, templates, docs, aggregate proof subreports',
      note: 'Measures controllable repo posture only.',
    }),
    scoreEntry({
      id: 'crypto-inventory-policy',
      label: 'Crypto inventory and policy enforcement',
      previousRange: '90-95%',
      currentScore: existsSync(repoPath(root, 'scripts/security/crypto-inventory.mjs'))
        && existsSync(repoPath(root, 'scripts/security/pqc-policy-check.mjs')) ? 96 : 80,
      targetRange: '95-98%',
      evidence: '`npm run security:pqc`, policy config, allowlist-aware blockers',
      note: 'Blocks repo-owned crypto drift; does not claim provider internals.',
    }),
    scoreEntry({
      id: 'ci-enforced-evidence',
      label: 'CI-enforced PQC evidence',
      previousRange: '80-88%',
      currentScore: ciInputsPass ? 96 : 78,
      targetRange: '94-98%',
      evidence: 'Post-Quantum Security and Security Gates workflows',
      note: 'Strict checks fail repo/config-owned evidence gaps.',
    }),
    scoreEntry({
      id: 'controllable-surface-deployment-proof',
      label: 'Controllable-surface deployment proof',
      previousRange: '55-70%',
      currentScore: controlledSurfaceScore,
      targetRange: '75-85%',
      evidence: 'SSH/TLS/internal/backup/release/lab/provider reports',
      note: configuredEvidenceCount > 0
        ? 'Some environment proof paths are configured or benchmarked.'
        : 'Environment proof paths exist but no live staging/production targets are configured in this local run.',
    }),
    scoreEntry({
      id: 'full-end-to-end-pqc-coverage',
      label: 'Full end-to-end PQC coverage',
      previousRange: '35-45%',
      currentScore: fullEndToEndScore,
      targetRange: '45-55%',
      evidence: 'Provider dependency register and ecosystem caveats',
      note: 'Capped because browser/WebPKI, auth, payment, email, app-store, database, and AI providers remain provider-dependent.',
    }),
  ];

  for (const entry of scores) {
    checks.push(check({
      id: `scorecard.dimension.${entry.id}`,
      title: `${entry.label} score is generated`,
      status: 'pass',
      scope: 'repo',
      severity: 'info',
      summary: `${entry.label}: ${entry.currentScore}% (previous ${entry.previousRange}, target ${entry.targetRange}).`,
      evidence: { score: entry.currentScore, targetRange: entry.targetRange },
    }));
  }

  checks.push(check({
    id: 'scorecard.provider-unknowns-lower-full-e2e-score',
    title: 'Provider unknowns lower the full end-to-end score without failing repo evidence',
    status: providerUnknownCount > 0 ? 'warning' : 'pass',
    scope: 'system',
    severity: providerUnknownCount > 0 ? 'medium' : 'info',
    summary: providerUnknownCount > 0
      ? `${providerUnknownCount} provider row(s) remain unknown/provider-dependent.`
      : 'No provider row is currently unknown/provider-dependent.',
    evidence: { providerUnknownCount },
  }));

  const overallScore = Math.round(
    (scores[0].currentScore * 0.3)
    + (scores[1].currentScore * 0.2)
    + (scores[2].currentScore * 0.2)
    + (scores[3].currentScore * 0.2)
    + (scores[4].currentScore * 0.1),
  );
  const summary = summarizeChecks(checks);
  return {
    title: 'PQC Maturity Scorecard',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    overallScore,
    configuredEvidenceCount,
    providerUnknownCount,
    scores,
    summary,
    checks,
    limitations: [
      'Scores are maturity estimates for governance and evidence tracking; they are not security guarantees.',
      'No system is 100% quantum-proof, and this scorecard must not be used as a quantum-proof claim.',
      'Provider-dependent cryptography caps full end-to-end PQC coverage until the ecosystem exposes verifiable migration paths.',
    ],
  };
};

export const renderPqcMaturityScorecardMarkdown = (report) => renderChecksMarkdown(report, [
  '## Scorecard',
  '',
  markdownTable(
    ['Dimension', 'Previous', 'Current', 'Target', 'Evidence', 'Note'],
    report.scores.map((entry) => [
      entry.label,
      entry.previousRange,
      `${entry.currentScore}%`,
      entry.targetRange,
      entry.evidence,
      entry.note,
    ]),
  ),
  '',
  `Overall weighted score: ${report.overallScore}%`,
  '',
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
]);

const main = async () => {
  const options = parseReadinessArgs(process.argv.slice(2));
  const report = await buildPqcMaturityScorecardReport(options);
  const markdown = renderPqcMaturityScorecardMarkdown(report);
  const written = writeReadinessReports({
    report,
    markdown,
    reportDir: options.reportDir,
    baseName: PQC_MATURITY_SCORECARD_REPORT_BASENAME,
    options,
  });
  console.log(`[pqc-maturity-scorecard] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) {
  await main();
}
