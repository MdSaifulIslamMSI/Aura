import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  check,
  defaultRepoRoot,
  hasForbiddenPrivateMaterial,
  isMainModule,
  parseReadinessArgs,
  readTextIfExists,
  renderChecksMarkdown,
  repoPath,
  shouldFail,
  summarizeChecks,
  writeReadinessReports,
} from './pqc-readiness-utils.mjs';

export const BACKUP_REPORT_BASENAME = 'backup-crypto-agility-check';
export const BACKUP_EVIDENCE_REPORT_BASENAME = 'backup-pqc-encryption-evidence';

const backupVerifier = 'scripts/smoke/backup-restore-check.mjs';
const isolatedRestoreDrill = 'scripts/smoke/isolated-restore-drill.mjs';
const backupDoc = 'docs/security/pqc-backup-key-agility.md';
const disabledModes = new Set(['', '0', 'false', 'off', 'disabled', 'skip', 'skipped']);

const readArgValue = (argv, name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : '';
};

const parseBackupArgs = (argv) => ({
  ...parseReadinessArgs(argv),
  backupEvidenceMode: readArgValue(argv, '--backup-evidence-mode') || readArgValue(argv, '--mode'),
});

const isConfigured = (value) => Boolean(String(value || '').trim());

const loadBackupPlanner = async (root) => {
  const moduleUrl = pathToFileURL(repoPath(root, backupVerifier)).href;
  return import(moduleUrl);
};

const loadIsolatedRestoreDrill = async (root) => {
  const moduleUrl = pathToFileURL(repoPath(root, isolatedRestoreDrill)).href;
  return import(moduleUrl);
};

export const buildBackupCryptoAgilityReport = async (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const checks = [];
  const doc = readTextIfExists(repoPath(root, backupDoc));
  const verifierSource = readTextIfExists(repoPath(root, backupVerifier));
  const restoreDrillSource = readTextIfExists(repoPath(root, isolatedRestoreDrill));

  checks.push(check({
    id: 'repo.backup-verifier.exists',
    title: 'Backup restore verifier exists',
    status: verifierSource ? 'pass' : 'fail',
    scope: 'repo',
    severity: verifierSource ? 'info' : 'high',
    summary: verifierSource ? `${backupVerifier} exists.` : `${backupVerifier} is missing.`,
    evidence: { file: backupVerifier },
  }));

  checks.push(check({
    id: 'repo.backup-doc.exists',
    title: 'Backup key-agility runbook exists',
    status: doc ? 'pass' : 'fail',
    scope: 'repo',
    severity: doc ? 'info' : 'high',
    summary: doc ? `${backupDoc} exists.` : `${backupDoc} is missing.`,
    evidence: { file: backupDoc },
  }));

  checks.push(check({
    id: 'repo.backup-restore-drill.exists',
    title: 'Isolated backup restore drill exists',
    status: restoreDrillSource ? 'pass' : 'fail',
    scope: 'repo',
    severity: restoreDrillSource ? 'info' : 'high',
    summary: restoreDrillSource ? `${isolatedRestoreDrill} exists.` : `${isolatedRestoreDrill} is missing.`,
    evidence: { file: isolatedRestoreDrill },
  }));

  for (const required of ['AES-256-GCM', 'ChaCha20-Poly1305', 'envelope encryption', 'restore dry run', 'rollback', 'rotatable']) {
    checks.push(check({
      id: `repo.backup-doc.${required.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: `Backup runbook documents ${required}`,
      status: doc.toLowerCase().includes(required.toLowerCase()) ? 'pass' : 'fail',
      scope: 'repo',
      severity: doc.toLowerCase().includes(required.toLowerCase()) ? 'info' : 'medium',
      summary: doc.toLowerCase().includes(required.toLowerCase())
        ? `Backup runbook covers ${required}.`
        : `Backup runbook is missing ${required}.`,
      evidence: { file: backupDoc },
    }));
  }

  let destructiveRestoreBlocked = false;
  let plannerLoaded = false;
  if (verifierSource) {
    try {
      const planner = await loadBackupPlanner(root);
      plannerLoaded = typeof planner.planBackupRestoreCheck === 'function';
      if (plannerLoaded) {
        const result = planner.planBackupRestoreCheck({
          DRY_RUN: 'false',
          RESTORE_TARGET_ENV: 'production',
          APPROVE_PRODUCTION_RESTORE: '',
          AURA_BACKUP_COMMAND: 'configured',
          AURA_RESTORE_COMMAND: 'configured',
          BACKUP_BUCKET_NAME: 'configured',
        });
        destructiveRestoreBlocked = result.blocked === true && result.reason === 'production_restore_blocked';
      }
    } catch {
      plannerLoaded = false;
    }
  }

  checks.push(check({
    id: 'repo.backup-verifier.importable',
    title: 'Backup verifier exposes a planning function',
    status: plannerLoaded ? 'pass' : 'fail',
    scope: 'repo',
    severity: plannerLoaded ? 'info' : 'high',
    summary: plannerLoaded
      ? 'Backup verifier can be imported without running a live restore.'
      : 'Backup verifier planning function is unavailable.',
    evidence: { file: backupVerifier },
  }));

  checks.push(check({
    id: 'repo.backup-restore.destructive-blocked',
    title: 'Production destructive restore is blocked by default',
    status: destructiveRestoreBlocked ? 'pass' : 'fail',
    scope: 'repo',
    severity: destructiveRestoreBlocked ? 'info' : 'high',
    summary: destructiveRestoreBlocked
      ? 'Production restore requires explicit dry-run override and approval.'
      : 'Production restore default safety could not be proven.',
    evidence: { file: backupVerifier },
  }));

  let isolatedDrillLoaded = false;
  let isolatedDrillProven = false;
  if (restoreDrillSource) {
    try {
      const drill = await loadIsolatedRestoreDrill(root);
      isolatedDrillLoaded = typeof drill.runIsolatedRestoreDrill === 'function';
      if (isolatedDrillLoaded) {
        const result = drill.runIsolatedRestoreDrill({
          env: {
            RESTORE_TARGET_ENV: 'test',
          },
        });
        isolatedDrillProven = result.ok === true
          && result.evidence?.scope === 'local_disposable_fixture'
          && result.evidence?.restoreDrillProven === true
          && result.evidence?.productionDataTouched === false;
      }
    } catch {
      isolatedDrillLoaded = false;
    }
  }

  checks.push(check({
    id: 'repo.backup-restore-drill.local-fixture-proven',
    title: 'Local isolated restore drill proves fixture recovery',
    status: isolatedDrillProven ? 'pass' : 'fail',
    scope: 'repo',
    severity: isolatedDrillProven ? 'info' : 'high',
    summary: isolatedDrillProven
      ? 'Disposable local backup and restore fixture completed with checksum evidence.'
      : 'Disposable local backup and restore fixture could not be proven.',
    evidence: { file: isolatedRestoreDrill, importable: isolatedDrillLoaded },
  }));

  const privateMaterialFiles = hasForbiddenPrivateMaterial(root, [backupDoc, backupVerifier, isolatedRestoreDrill]);
  checks.push(check({
    id: 'repo.backup.no-private-material',
    title: 'Backup docs/scripts do not contain committed private key material',
    status: privateMaterialFiles.length === 0 ? 'pass' : 'fail',
    scope: 'repo',
    severity: privateMaterialFiles.length === 0 ? 'info' : 'critical',
    summary: privateMaterialFiles.length === 0
      ? 'No committed private key material was found in backup evidence files.'
      : `Private key material appears in ${privateMaterialFiles.join(', ')}.`,
    evidence: { files: [backupDoc, backupVerifier, isolatedRestoreDrill] },
  }));

  const hardcodedKeyPattern = /(BACKUP|RESTORE|ENCRYPTION|DECRYPTION)_[A-Z_]*KEY\s*=\s*(?!\$\{|<|example|changeme|redacted|\[REDACTED\])/i;
  const hardcodedKey = hardcodedKeyPattern.test(`${doc}\n${verifierSource}\n${restoreDrillSource}`);
  checks.push(check({
    id: 'repo.backup.no-hardcoded-key',
    title: 'Backup evidence avoids hardcoded encryption keys',
    status: hardcodedKey ? 'fail' : 'pass',
    scope: 'repo',
    severity: hardcodedKey ? 'critical' : 'info',
    summary: hardcodedKey
      ? 'Backup evidence appears to contain a hardcoded encryption key assignment.'
      : 'Backup evidence avoids hardcoded encryption key assignments.',
    evidence: { files: [backupDoc, backupVerifier, isolatedRestoreDrill] },
  }));

  const summary = summarizeChecks(checks);
  const report = {
    title: 'Backup Crypto-Agility Readiness',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    summary,
    checks,
    limitations: [
      'This checker proves repo safety posture and does not decrypt or restore production backups.',
      'The isolated restore drill proves only a disposable local fixture, not managed backup provider retention.',
      'Future PQ KEM wrapping for backup keys should wait for mature tooling and staging evidence.',
      'Backup key material must stay in approved secret storage, never in repo logs or reports.',
    ],
  };

  return report;
};

export const buildBackupPqcEncryptionEvidenceReport = async (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const env = options.env || process.env;
  const checks = [];
  const mode = String(
    options.backupEvidenceMode
    || env.PQC_BACKUP_EVIDENCE_MODE
    || env.PQC_ENV_PROOF_MODE
    || 'disabled',
  ).trim().toLowerCase();
  const enabled = !disabledModes.has(mode);
  const doc = readTextIfExists(repoPath(root, backupDoc));
  const verifierSource = readTextIfExists(repoPath(root, backupVerifier));

  checks.push(check({
    id: 'backup.environment-proof.mode',
    title: 'Backup evidence mode is explicit',
    status: enabled ? 'pass' : 'skipped',
    scope: 'system',
    severity: enabled ? 'info' : 'medium',
    summary: enabled
      ? `Backup evidence mode is ${mode}.`
      : 'Backup environment evidence is disabled; set PQC_BACKUP_EVIDENCE_MODE=staging to validate dry-run restore shape.',
    evidence: { mode },
  }));

  let plannerLoaded = false;
  let plan = null;
  if (verifierSource) {
    try {
      const planner = await loadBackupPlanner(root);
      plannerLoaded = typeof planner.planBackupRestoreCheck === 'function';
      if (plannerLoaded) {
        plan = planner.planBackupRestoreCheck({
          ...env,
          DRY_RUN: env.DRY_RUN ?? 'true',
          RESTORE_TARGET_ENV: env.RESTORE_TARGET_ENV || (enabled ? 'staging' : 'development'),
        });
      }
    } catch {
      plannerLoaded = false;
    }
  }

  checks.push(check({
    id: 'backup.environment-proof.planner-importable',
    title: 'Backup restore planner is importable for non-destructive evidence',
    status: plannerLoaded ? 'pass' : 'fail',
    scope: 'repo',
    severity: plannerLoaded ? 'info' : 'high',
    summary: plannerLoaded
      ? 'Backup restore planner was imported without executing backup or restore commands.'
      : 'Backup restore planner could not be imported.',
    evidence: { file: backupVerifier },
  }));

  const missing = Array.isArray(plan?.missing) ? plan.missing : [];
  checks.push(check({
    id: 'backup.environment-proof.runtime-config-present',
    title: 'Backup, restore, and storage settings are configured when evidence mode is enabled',
    status: enabled ? (missing.length === 0 ? 'pass' : 'fail') : 'skipped',
    scope: enabled ? 'policy' : 'system',
    severity: enabled && missing.length > 0 ? 'high' : 'info',
    summary: enabled
      ? (missing.length === 0
        ? 'Backup/restore dry-run settings are configured without exposing command or storage values.'
        : `Backup evidence is missing required setting group(s): ${missing.join(', ')}.`)
      : 'Backup runtime settings are not required while evidence mode is disabled.',
    evidence: { missing },
  }));

  const dryRun = plan?.checks?.dryRun !== false;
  checks.push(check({
    id: 'backup.environment-proof.dry-run-only',
    title: 'Backup evidence remains a dry-run by default',
    status: dryRun ? 'pass' : 'fail',
    scope: enabled ? 'policy' : 'system',
    severity: dryRun ? 'info' : 'high',
    summary: dryRun
      ? 'Backup evidence plan is dry-run only.'
      : 'Backup evidence would allow a non-dry-run path; this branch must not run destructive restores.',
    evidence: { dryRun },
  }));

  const productionWriteApproved = plan?.checks?.targetEnvironment === 'production'
    && plan?.checks?.dryRun === false
    && plan?.checks?.approveProductionRestore === true;
  checks.push(check({
    id: 'backup.environment-proof.no-production-write',
    title: 'Production restore writes remain blocked for PQC evidence',
    status: productionWriteApproved ? 'fail' : 'pass',
    scope: 'policy',
    severity: productionWriteApproved ? 'critical' : 'info',
    summary: productionWriteApproved
      ? 'Production restore approval variables are set; do not use this PQC evidence path for destructive production restore.'
      : 'PQC backup evidence does not approve a production restore write.',
    evidence: {
      targetEnvironment: plan?.checks?.targetEnvironment || 'unknown',
      dryRun,
      approveProductionRestore: Boolean(plan?.checks?.approveProductionRestore),
    },
  }));

  for (const required of ['AES-256-GCM', 'ChaCha20-Poly1305', 'envelope encryption', 'rotatable', 'restore dry run']) {
    checks.push(check({
      id: `backup.environment-proof.doc.${required.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: `Backup evidence keeps ${required} documented`,
      status: doc.toLowerCase().includes(required.toLowerCase()) ? 'pass' : 'fail',
      scope: 'repo',
      severity: doc.toLowerCase().includes(required.toLowerCase()) ? 'info' : 'medium',
      summary: doc.toLowerCase().includes(required.toLowerCase())
        ? `Backup evidence references ${required}.`
        : `Backup evidence is missing ${required}.`,
      evidence: { file: backupDoc },
    }));
  }

  const configuredKeys = [
    'AURA_BACKUP_COMMAND',
    'MONGODB_BACKUP_COMMAND',
    'STAGING_BACKUP_COMMAND',
    'AURA_RESTORE_COMMAND',
    'MONGODB_RESTORE_COMMAND',
    'AURA_BACKUP_STORAGE_URI',
    'BACKUP_BUCKET_NAME',
    'STAGING_BUCKET_NAME',
  ].filter((key) => isConfigured(env[key]));
  checks.push(check({
    id: 'backup.environment-proof.no-raw-runtime-values',
    title: 'Backup evidence stores only setting presence, not runtime values',
    status: 'pass',
    scope: 'repo',
    severity: 'info',
    summary: 'Runtime backup command and storage values are reduced to configured setting names.',
    evidence: { configuredSettingNames: configuredKeys },
  }));

  const summary = summarizeChecks(checks);
  return {
    title: 'Backup PQC Encryption Evidence',
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    mode,
    plannerReason: plan?.reason || 'not-run',
    summary,
    checks,
    limitations: [
      'This evidence path plans a dry-run restore check and never decrypts or writes production backups.',
      'Symmetric backup encryption remains appropriate when keys are rotatable and stored outside the repo.',
      'Future PQ KEM key wrapping remains a staging-only migration path until mature tooling exists.',
    ],
  };
};

export const renderBackupCryptoAgilityMarkdown = (report) => renderChecksMarkdown(report, [
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
]);

export const renderBackupPqcEncryptionEvidenceMarkdown = (report) => renderChecksMarkdown(report, [
  '## Planner',
  '',
  `- Mode: ${report.mode}`,
  `- Reason: ${report.plannerReason}`,
  '',
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
]);

const main = async () => {
  const options = parseBackupArgs(process.argv.slice(2));
  const report = await buildBackupCryptoAgilityReport(options);
  const evidenceReport = await buildBackupPqcEncryptionEvidenceReport(options);
  const markdown = renderBackupCryptoAgilityMarkdown(report);
  const written = [
    ...writeReadinessReports({
    report,
    markdown,
    reportDir: options.reportDir,
    baseName: BACKUP_REPORT_BASENAME,
    options,
    }),
    ...writeReadinessReports({
      report: evidenceReport,
      markdown: renderBackupPqcEncryptionEvidenceMarkdown(evidenceReport),
      reportDir: options.reportDir,
      baseName: BACKUP_EVIDENCE_REPORT_BASENAME,
      options,
    }),
  ];
  console.log(`[backup-crypto-agility] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail' || evidenceReport.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) {
  await main();
}
