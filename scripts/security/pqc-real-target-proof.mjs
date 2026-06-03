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
import { buildSshPqcEnvironmentProofReport } from './check-ssh-pqc-readiness.mjs';
import { buildTlsEndpointPqcReadinessReport } from './tls-endpoint-pqc-readiness.mjs';
import { buildInternalServiceEncryptionEvidenceReport } from './internal-service-encryption-check.mjs';
import { buildBackupPqcEncryptionEvidenceReport } from './backup-crypto-agility-check.mjs';
import { buildReleaseSigningReadinessReport } from './release-signing-readiness-check.mjs';
import { buildPqcProviderRegisterReport } from './pqc-provider-register-check.mjs';

export const PQC_REAL_TARGET_REPORT_BASENAME = 'pqc-real-target-proof';

const disabledModes = new Set(['', '0', 'false', 'off', 'disabled', 'skip', 'skipped']);

const normalizeEnvAliases = (env = process.env) => ({
  ...env,
  PQC_ENV_PROOF_MODE: env.PQC_REAL_TARGET_PROOF_MODE || env.PQC_ENV_PROOF_MODE || 'disabled',
  PQC_SSH_PROOF_MODE: env.PQC_SSH_PROOF_MODE || env.PQC_REAL_TARGET_PROOF_MODE || 'disabled',
  PQC_SSH_HOST: env.PQC_SSH_HOST || env.PQC_SSH_TARGET_HOST || '',
  PQC_SSH_PORT: env.PQC_SSH_PORT || env.PQC_SSH_TARGET_PORT || '',
  PQC_SSH_USER: env.PQC_SSH_USER || env.PQC_SSH_TARGET_USER || '',
  PQC_SSH_EXPECTED_KEX: env.PQC_SSH_EXPECTED_KEX || env.PQC_SSH_TARGET_EXPECTED_KEX || '',
  PQC_TLS_PROOF_MODE: env.PQC_TLS_PROOF_MODE || env.PQC_REAL_TARGET_PROOF_MODE || 'disabled',
  PQC_TLS_REQUIRE_TLS13: env.PQC_TLS_REQUIRE_TLS13 || env.PQC_TLS_EXPECT_TLS13 || 'true',
  PQC_INTERNAL_EVIDENCE_MODE: env.PQC_INTERNAL_EVIDENCE_MODE || env.PQC_INTERNAL_SERVICE_PROOF_MODE || env.PQC_REAL_TARGET_PROOF_MODE || 'disabled',
  PQC_BACKUP_EVIDENCE_MODE: env.PQC_BACKUP_EVIDENCE_MODE || env.PQC_BACKUP_PROOF_MODE || env.PQC_REAL_TARGET_PROOF_MODE || 'disabled',
});

const isConfiguredReport = (report) => {
  const mode = String(report?.mode || '').trim().toLowerCase();
  return mode && !disabledModes.has(mode);
};

export const buildPqcRealTargetProofReport = async (options = {}) => {
  const env = normalizeEnvAliases(options.env || process.env);
  const proofOptions = { ...options, env };
  const subreports = {
    ssh: buildSshPqcEnvironmentProofReport(proofOptions),
    tlsEndpoint: await buildTlsEndpointPqcReadinessReport(proofOptions),
    internalServices: buildInternalServiceEncryptionEvidenceReport(proofOptions),
    backups: await buildBackupPqcEncryptionEvidenceReport(proofOptions),
    releaseSigning: buildReleaseSigningReadinessReport(proofOptions),
    providerRegister: buildPqcProviderRegisterReport(proofOptions),
  };

  const checks = Object.entries(subreports).map(([name, report]) => check({
    id: `pqc.real-target.${name}`,
    title: `${name} real-target input passes or is safely skipped`,
    status: report.status === 'pass' ? 'pass' : 'fail',
    scope: report.status === 'pass' ? 'repo' : 'policy',
    severity: report.status === 'pass' ? 'info' : 'high',
    summary: `${name} status is ${report.status}.`,
    evidence: { mode: report.mode || 'repo', summary: report.summary },
  }));

  const configuredTargets = Object.values(subreports).filter(isConfiguredReport).length;
  checks.push(check({
    id: 'pqc.real-target.disabled-default-safe',
    title: 'Disabled/default mode is safe and non-mutating',
    status: configuredTargets === 0 ? 'pass' : 'pass',
    scope: 'repo',
    severity: 'info',
    summary: configuredTargets === 0
      ? 'No live target proof is configured; reports honestly record skipped/disabled posture.'
      : `${configuredTargets} real-target evidence path(s) are explicitly configured.`,
    evidence: { configuredTargets },
  }));

  const rawEvidence = JSON.stringify(subreports);
  const rawLeak = /(authorization|cookie|private[_-]?key|BEGIN [A-Z ]*PRIVATE KEY|password|api[_-]?key)\s*[:=]/i.test(rawEvidence);
  checks.push(check({
    id: 'pqc.real-target.no-sensitive-output',
    title: 'Real-target evidence does not include raw sensitive headers or private key material',
    status: rawLeak ? 'fail' : 'pass',
    scope: 'repo',
    severity: rawLeak ? 'critical' : 'info',
    summary: rawLeak
      ? 'Sensitive-looking material was found in the generated evidence object.'
      : 'Evidence object does not contain raw sensitive headers, private keys, or credential assignments.',
    evidence: { redaction: 'checked' },
  }));

  const summary = summarizeChecks(checks);
  return {
    title: 'PQC Real Target Proof',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    configuredTargets,
    subreports,
    summary,
    checks,
    limitations: [
      'Default mode is disabled and does not open network, database, backup, DNS, CDN, or production configuration connections.',
      'Production-read-only mode must remain non-mutating and explicitly configured by the operator.',
      'Browser, WebPKI, app-store, auth, payment, email, database, and AI provider PQC migration remain ecosystem-dependent.',
    ],
  };
};

export const renderPqcRealTargetProofMarkdown = (report) => renderChecksMarkdown(report, [
  '## Subreports',
  '',
  markdownTable(
    ['Name', 'Status', 'Mode', 'Pass', 'Warning', 'Fail', 'Skipped'],
    Object.entries(report.subreports).map(([name, subreport]) => [
      name,
      subreport.status,
      subreport.mode || 'repo',
      subreport.summary?.pass ?? 0,
      subreport.summary?.warning ?? 0,
      subreport.summary?.fail ?? 0,
      subreport.summary?.skipped ?? 0,
    ]),
  ),
  '',
  `Configured target evidence paths: ${report.configuredTargets}`,
  '',
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
]);

const main = async () => {
  const options = parseReadinessArgs(process.argv.slice(2));
  const report = await buildPqcRealTargetProofReport(options);
  const markdown = renderPqcRealTargetProofMarkdown(report);
  const written = writeReadinessReports({
    report,
    markdown,
    reportDir: options.reportDir,
    baseName: PQC_REAL_TARGET_REPORT_BASENAME,
    options,
  });
  console.log(`[pqc-real-target-proof] ${report.status}: configured ${report.configuredTargets} target path(s); wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) {
  await main();
}
