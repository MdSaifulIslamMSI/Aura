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

const backupVerifier = 'scripts/smoke/backup-restore-check.mjs';
const backupDoc = 'docs/security/pqc-backup-key-agility.md';

const loadBackupPlanner = async (root) => {
  const moduleUrl = pathToFileURL(repoPath(root, backupVerifier)).href;
  return import(moduleUrl);
};

export const buildBackupCryptoAgilityReport = async (options = {}) => {
  const root = options.root || defaultRepoRoot;
  const checks = [];
  const doc = readTextIfExists(repoPath(root, backupDoc));
  const verifierSource = readTextIfExists(repoPath(root, backupVerifier));

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

  const privateMaterialFiles = hasForbiddenPrivateMaterial(root, [backupDoc, backupVerifier]);
  checks.push(check({
    id: 'repo.backup.no-private-material',
    title: 'Backup docs/scripts do not contain committed private key material',
    status: privateMaterialFiles.length === 0 ? 'pass' : 'fail',
    scope: 'repo',
    severity: privateMaterialFiles.length === 0 ? 'info' : 'critical',
    summary: privateMaterialFiles.length === 0
      ? 'No committed private key material was found in backup evidence files.'
      : `Private key material appears in ${privateMaterialFiles.join(', ')}.`,
    evidence: { files: [backupDoc, backupVerifier] },
  }));

  const hardcodedKeyPattern = /(BACKUP|RESTORE|ENCRYPTION|DECRYPTION)_[A-Z_]*KEY\s*=\s*(?!\$\{|<|example|changeme|redacted|\[REDACTED\])/i;
  const hardcodedKey = hardcodedKeyPattern.test(`${doc}\n${verifierSource}`);
  checks.push(check({
    id: 'repo.backup.no-hardcoded-key',
    title: 'Backup evidence avoids hardcoded encryption keys',
    status: hardcodedKey ? 'fail' : 'pass',
    scope: 'repo',
    severity: hardcodedKey ? 'critical' : 'info',
    summary: hardcodedKey
      ? 'Backup evidence appears to contain a hardcoded encryption key assignment.'
      : 'Backup evidence avoids hardcoded encryption key assignments.',
    evidence: { files: [backupDoc, backupVerifier] },
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
      'Future PQ KEM wrapping for backup keys should wait for mature tooling and staging evidence.',
      'Backup key material must stay in approved secret storage, never in repo logs or reports.',
    ],
  };

  return report;
};

export const renderBackupCryptoAgilityMarkdown = (report) => renderChecksMarkdown(report, [
  '## Limitations',
  '',
  ...report.limitations.map((entry) => `- ${entry}`),
]);

const main = async () => {
  const options = parseReadinessArgs(process.argv.slice(2));
  const report = await buildBackupCryptoAgilityReport(options);
  const markdown = renderBackupCryptoAgilityMarkdown(report);
  const written = writeReadinessReports({
    report,
    markdown,
    reportDir: options.reportDir,
    baseName: BACKUP_REPORT_BASENAME,
    options,
  });
  console.log(`[backup-crypto-agility] ${report.status}: wrote ${written.map((file) => path.relative(options.root, file)).join(', ')}`);
  if (report.status === 'fail') process.exit(1);
};

if (isMainModule(import.meta.url)) {
  await main();
}
