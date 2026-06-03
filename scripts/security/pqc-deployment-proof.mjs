import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  check,
  defaultRepoRoot,
  isMainModule,
  parseReadinessArgs,
  readJsonIfExists,
  renderChecksMarkdown,
  repoPath,
  runCommand,
  shouldFail,
  summarizeChecks,
  versionAtLeast,
  writeReadinessReports,
} from './pqc-readiness-utils.mjs';
import {
  SSH_ENV_REPORT_BASENAME,
  SSH_REPORT_BASENAME,
  buildSshPqcEnvironmentProofReport,
  buildSshPqcReadinessReport,
  renderSshPqcEnvironmentProofMarkdown,
  renderSshPqcReadinessMarkdown,
} from './check-ssh-pqc-readiness.mjs';
import {
  TLS_REPORT_BASENAME,
  buildTlsConfigReadinessReport,
  renderTlsConfigReadinessMarkdown,
} from './tls-config-readiness.mjs';
import {
  TLS_ENDPOINT_REPORT_BASENAME,
  buildTlsEndpointPqcReadinessReport,
  renderTlsEndpointPqcReadinessMarkdown,
} from './tls-endpoint-pqc-readiness.mjs';
import {
  PQC_LAB_BENCHMARK_REPORT_BASENAME,
  PQC_LAB_REPORT_BASENAME,
  buildPqcLabBenchmarkReport,
  buildPqcLabSmokeReport,
  renderPqcLabBenchmarkMarkdown,
  renderPqcLabSmokeMarkdown,
} from './pqc-lab-smoke.mjs';
import {
  INTERNAL_SERVICE_EVIDENCE_REPORT_BASENAME,
  INTERNAL_SERVICE_REPORT_BASENAME,
  buildInternalServiceEncryptionEvidenceReport,
  buildInternalServiceEncryptionReport,
  renderInternalServiceEncryptionEvidenceMarkdown,
  renderInternalServiceEncryptionMarkdown,
} from './internal-service-encryption-check.mjs';
import {
  BACKUP_EVIDENCE_REPORT_BASENAME,
  BACKUP_REPORT_BASENAME,
  buildBackupCryptoAgilityReport,
  buildBackupPqcEncryptionEvidenceReport,
  renderBackupCryptoAgilityMarkdown,
  renderBackupPqcEncryptionEvidenceMarkdown,
} from './backup-crypto-agility-check.mjs';
import {
  RELEASE_SIGNING_REPORT_BASENAME,
  buildReleaseSigningReadinessReport,
  renderReleaseSigningReadinessMarkdown,
} from './release-signing-readiness-check.mjs';
import {
  PQC_PROVIDER_REGISTER_REPORT_BASENAME,
  buildPqcProviderRegisterReport,
  renderPqcProviderRegisterMarkdown,
} from './pqc-provider-register-check.mjs';

export const PQC_DEPLOYMENT_PROOF_BASENAME = 'pqc-deployment-proof';

const repoArtifacts = [
  'config/security/post-quantum-policy.json',
  'scripts/security/crypto-inventory.mjs',
  'scripts/security/pqc-policy-check.mjs',
  'scripts/security/route-enforcement-coverage.mjs',
  'scripts/security/tls-endpoint-pqc-readiness.mjs',
  'scripts/security/release-signing-readiness-check.mjs',
  'scripts/security/pqc-provider-register-check.mjs',
  'scripts/security/pqc-maturity-scorecard.mjs',
  'scripts/smoke/backup-restore-check.mjs',
  'docs/security/pqc-controlled-surface-matrix.md',
  'docs/security/pqc-ssh-hardening.md',
  'docs/security/pqc-tls-edge-readiness.md',
  'docs/security/pqc-openssl-oqs-lab-results.md',
  'docs/security/internal-service-encryption-readiness.md',
  'docs/security/pqc-backup-key-agility.md',
  'docs/security/pqc-release-signing-readiness.md',
  'docs/security/pqc-provider-dependency-register.md',
  'docs/security/pqc-maturity-scorecard.md',
  'docs/security/pr-pqc-real-environment-evidence-upgrade.md',
];

const reportArtifacts = [
  'crypto-inventory.json',
  'crypto-inventory.md',
  'pqc-policy-check.json',
  'pqc-policy-check.md',
  `${SSH_REPORT_BASENAME}.json`,
  `${SSH_REPORT_BASENAME}.md`,
  `${SSH_ENV_REPORT_BASENAME}.json`,
  `${SSH_ENV_REPORT_BASENAME}.md`,
  `${TLS_REPORT_BASENAME}.json`,
  `${TLS_REPORT_BASENAME}.md`,
  `${TLS_ENDPOINT_REPORT_BASENAME}.json`,
  `${TLS_ENDPOINT_REPORT_BASENAME}.md`,
  `${PQC_LAB_REPORT_BASENAME}.json`,
  `${PQC_LAB_REPORT_BASENAME}.md`,
  `${PQC_LAB_BENCHMARK_REPORT_BASENAME}.json`,
  `${PQC_LAB_BENCHMARK_REPORT_BASENAME}.md`,
  `${INTERNAL_SERVICE_REPORT_BASENAME}.json`,
  `${INTERNAL_SERVICE_REPORT_BASENAME}.md`,
  `${INTERNAL_SERVICE_EVIDENCE_REPORT_BASENAME}.json`,
  `${INTERNAL_SERVICE_EVIDENCE_REPORT_BASENAME}.md`,
  `${BACKUP_REPORT_BASENAME}.json`,
  `${BACKUP_REPORT_BASENAME}.md`,
  `${BACKUP_EVIDENCE_REPORT_BASENAME}.json`,
  `${BACKUP_EVIDENCE_REPORT_BASENAME}.md`,
  `${RELEASE_SIGNING_REPORT_BASENAME}.json`,
  `${RELEASE_SIGNING_REPORT_BASENAME}.md`,
  `${PQC_PROVIDER_REGISTER_REPORT_BASENAME}.json`,
  `${PQC_PROVIDER_REGISTER_REPORT_BASENAME}.md`,
];

const generateExistingPqcReports = (root, reportDir) => {
  const inventoryScript = repoPath(root, 'scripts/security/crypto-inventory.mjs');
  const policyScript = repoPath(root, 'scripts/security/pqc-policy-check.mjs');
  const results = [];
  if (existsSync(inventoryScript)) {
    results.push(runCommand(process.execPath, [inventoryScript, '--report-dir', reportDir, '--json', '--markdown'], {
      cwd: root,
      timeoutMs: 30000,
    }));
  }
  if (existsSync(policyScript)) {
    results.push(runCommand(process.execPath, [policyScript, '--report-dir', reportDir], {
      cwd: root,
      timeoutMs: 30000,
    }));
  }
  return results;
};

const writeSubReports = ({ subreports, options }) => {
  const written = [];
  written.push(...writeReadinessReports({
    report: subreports.ssh,
    markdown: renderSshPqcReadinessMarkdown(subreports.ssh),
    reportDir: options.reportDir,
    baseName: SSH_REPORT_BASENAME,
    options,
  }));
  written.push(...writeReadinessReports({
    report: subreports.sshEnvironment,
    markdown: renderSshPqcEnvironmentProofMarkdown(subreports.sshEnvironment),
    reportDir: options.reportDir,
    baseName: SSH_ENV_REPORT_BASENAME,
    options,
  }));
  written.push(...writeReadinessReports({
    report: subreports.tls,
    markdown: renderTlsConfigReadinessMarkdown(subreports.tls),
    reportDir: options.reportDir,
    baseName: TLS_REPORT_BASENAME,
    options,
  }));
  written.push(...writeReadinessReports({
    report: subreports.tlsEndpoint,
    markdown: renderTlsEndpointPqcReadinessMarkdown(subreports.tlsEndpoint),
    reportDir: options.reportDir,
    baseName: TLS_ENDPOINT_REPORT_BASENAME,
    options,
  }));
  written.push(...writeReadinessReports({
    report: subreports.lab,
    markdown: renderPqcLabSmokeMarkdown(subreports.lab),
    reportDir: options.reportDir,
    baseName: PQC_LAB_REPORT_BASENAME,
    options,
  }));
  written.push(...writeReadinessReports({
    report: subreports.labBenchmark,
    markdown: renderPqcLabBenchmarkMarkdown(subreports.labBenchmark),
    reportDir: options.reportDir,
    baseName: PQC_LAB_BENCHMARK_REPORT_BASENAME,
    options,
  }));
  written.push(...writeReadinessReports({
    report: subreports.internalServices,
    markdown: renderInternalServiceEncryptionMarkdown(subreports.internalServices),
    reportDir: options.reportDir,
    baseName: INTERNAL_SERVICE_REPORT_BASENAME,
    options,
  }));
  written.push(...writeReadinessReports({
    report: subreports.internalEvidence,
    markdown: renderInternalServiceEncryptionEvidenceMarkdown(subreports.internalEvidence),
    reportDir: options.reportDir,
    baseName: INTERNAL_SERVICE_EVIDENCE_REPORT_BASENAME,
    options,
  }));
  written.push(...writeReadinessReports({
    report: subreports.backups,
    markdown: renderBackupCryptoAgilityMarkdown(subreports.backups),
    reportDir: options.reportDir,
    baseName: BACKUP_REPORT_BASENAME,
    options,
  }));
  written.push(...writeReadinessReports({
    report: subreports.backupEvidence,
    markdown: renderBackupPqcEncryptionEvidenceMarkdown(subreports.backupEvidence),
    reportDir: options.reportDir,
    baseName: BACKUP_EVIDENCE_REPORT_BASENAME,
    options,
  }));
  written.push(...writeReadinessReports({
    report: subreports.releaseSigning,
    markdown: renderReleaseSigningReadinessMarkdown(subreports.releaseSigning),
    reportDir: options.reportDir,
    baseName: RELEASE_SIGNING_REPORT_BASENAME,
    options,
  }));
  written.push(...writeReadinessReports({
    report: subreports.providerRegister,
    markdown: renderPqcProviderRegisterMarkdown(subreports.providerRegister),
    reportDir: options.reportDir,
    baseName: PQC_PROVIDER_REGISTER_REPORT_BASENAME,
    options,
  }));
  return written;
};

export const buildPqcDeploymentProofReport = async (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const checks = [];

  const policyPath = repoPath(root, 'config/security/post-quantum-policy.json');
  const policy = readJsonIfExists(policyPath, null);
  checks.push(check({
    id: 'repo.pqc-policy.exists',
    title: 'PQC policy config exists',
    status: policy ? 'pass' : 'fail',
    scope: 'repo',
    severity: policy ? 'info' : 'high',
    summary: policy ? 'PQC policy config is present.' : 'PQC policy config is missing.',
    evidence: { file: 'config/security/post-quantum-policy.json' },
  }));

  for (const relativeFile of repoArtifacts) {
    const exists = existsSync(repoPath(root, relativeFile));
    checks.push(check({
      id: `repo.artifact.${relativeFile}`,
      title: `${relativeFile} exists`,
      status: exists ? 'pass' : 'fail',
      scope: 'repo',
      severity: exists ? 'info' : 'high',
      summary: exists ? `${relativeFile} exists.` : `${relativeFile} is missing.`,
      evidence: { file: relativeFile },
    }));
  }

  checks.push(check({
    id: 'runtime.node-version',
    title: 'Node runtime version is captured',
    status: process.version ? 'pass' : 'fail',
    scope: 'system',
    severity: process.version ? 'info' : 'medium',
    summary: `Node runtime: ${process.version || 'unknown'}.`,
    evidence: { node: process.version },
  }));

  checks.push(check({
    id: 'runtime.node-openssl-version',
    title: 'Node OpenSSL version is captured',
    status: process.versions.openssl ? 'pass' : 'warning',
    scope: 'system',
    severity: process.versions.openssl ? 'info' : 'medium',
    summary: `Node OpenSSL: ${process.versions.openssl || 'unknown'}.`,
    evidence: { openssl: process.versions.openssl || '' },
  }));

  checks.push(check({
    id: 'runtime.node-openssl35',
    title: 'Node is linked against OpenSSL 3.5+',
    status: versionAtLeast(process.versions.openssl, [3, 5, 0]) ? 'pass' : 'warning',
    scope: 'system',
    severity: versionAtLeast(process.versions.openssl, [3, 5, 0]) ? 'info' : 'medium',
    summary: versionAtLeast(process.versions.openssl, [3, 5, 0])
      ? 'Node OpenSSL meets the 3.5+ target.'
      : 'Node OpenSSL is below 3.5 or unavailable; this does not fail repo evidence.',
    evidence: { openssl: process.versions.openssl || '' },
  }));

  const generatedPqcReports = generateExistingPqcReports(root, options.reportDir || repoPath(root, 'reports/security'));
  for (const result of generatedPqcReports) {
    checks.push(check({
      id: `repo.generated.${result.command.includes('pqc-policy-check') ? 'pqc-policy' : 'crypto-inventory'}`,
      title: `${result.command} generated reports`,
      status: result.status === 0 ? 'pass' : 'fail',
      scope: 'repo',
      severity: result.status === 0 ? 'info' : 'high',
      summary: result.status === 0
        ? `${result.command} completed.`
        : `${result.command} failed.`,
      evidence: { command: result.command, status: result.status },
    }));
  }

  const subreports = {
    ssh: buildSshPqcReadinessReport(options),
    sshEnvironment: buildSshPqcEnvironmentProofReport(options),
    tls: buildTlsConfigReadinessReport(options),
    tlsEndpoint: await buildTlsEndpointPqcReadinessReport(options),
    lab: buildPqcLabSmokeReport(options),
    labBenchmark: buildPqcLabBenchmarkReport(options),
    internalServices: buildInternalServiceEncryptionReport(options),
    internalEvidence: buildInternalServiceEncryptionEvidenceReport(options),
    backups: await buildBackupCryptoAgilityReport(options),
    backupEvidence: await buildBackupPqcEncryptionEvidenceReport(options),
    releaseSigning: buildReleaseSigningReadinessReport(options),
    providerRegister: buildPqcProviderRegisterReport(options),
  };
  writeSubReports({ subreports, options });

  const subreportStatus = Object.entries(subreports).map(([name, report]) => ({
    name,
    status: report.status,
    summary: report.summary,
  }));
  for (const entry of subreportStatus) {
    checks.push(check({
      id: `subreport.${entry.name}`,
      title: `${entry.name} subreport passed`,
      status: entry.status === 'pass' ? 'pass' : 'fail',
      scope: 'repo',
      severity: entry.status === 'pass' ? 'info' : 'high',
      summary: `${entry.name} subreport status: ${entry.status}.`,
      evidence: { summary: entry.summary },
    }));
  }

  for (const artifact of reportArtifacts) {
    const exists = existsSync(path.join(options.reportDir || repoPath(root, 'reports/security'), artifact));
    checks.push(check({
      id: `report.${artifact}`,
      title: `${artifact} was generated`,
      status: exists ? 'pass' : (options.strict ? 'fail' : 'warning'),
      scope: 'repo',
      severity: exists ? 'info' : 'medium',
      summary: exists
        ? `${artifact} exists in the report directory.`
        : `${artifact} was not found in the report directory.`,
      evidence: { file: `reports/security/${artifact}` },
    }));
  }

  const summary = summarizeChecks(checks);
  const report = {
    title: 'PQC Deployment Proof For Controllable Surfaces',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    ci: Boolean(options.ci),
    allowMissingSystemTools: Boolean(options.allowMissingSystemTools),
    readinessTargets: {
      practicalPqcReadiness: '95-98% target posture for repo-owned controls, not a guarantee',
      controllableSurfaceDeploymentProof: '75-85% target posture when optional environment proof is configured',
      fullEndToEndPqcCoverage: '45-55% target posture until provider and ecosystem crypto become verifiable',
      migrationMode: 'hybrid-first',
    },
    summary,
    checks,
    subreports: subreportStatus,
    limitations: [
      'No system is 100% quantum-proof.',
      'Full browser/provider end-to-end PQC is ecosystem-dependent.',
      'Firebase, Stripe, Razorpay, Resend, hosted databases, AI providers, app stores, and third-party SDK crypto remain partly outside Aura control.',
      'OQS/liboqs production use remains lab/staging only unless deliberately approved with rollback evidence.',
      'Hybrid migration is safer than replacing classical crypto in one jump.',
    ],
  };

  return report;
};

export const renderPqcDeploymentProofMarkdown = (report) => renderChecksMarkdown(report, [
  '## Readiness Targets',
  '',
  `- Practical PQC readiness: ${report.readinessTargets.practicalPqcReadiness}`,
  `- Controllable-surface deployment proof: ${report.readinessTargets.controllableSurfaceDeploymentProof}`,
  `- Full end-to-end PQC coverage: ${report.readinessTargets.fullEndToEndPqcCoverage}`,
  `- Migration mode: ${report.readinessTargets.migrationMode}`,
  '',
  '## Subreports',
  '',
  ...report.subreports.map((entry) => `- ${entry.name}: ${entry.status}`),
  '',
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
]);

const main = async () => {
  const options = parseReadinessArgs(process.argv.slice(2));
  const report = await buildPqcDeploymentProofReport(options);
  const markdown = renderPqcDeploymentProofMarkdown(report);
  const written = writeReadinessReports({
    report,
    markdown,
    reportDir: options.reportDir,
    baseName: PQC_DEPLOYMENT_PROOF_BASENAME,
    options,
  });
  console.log(`[pqc-deployment-proof] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) {
  await main();
}
