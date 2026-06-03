#!/usr/bin/env node

import { pathToFileURL } from 'url';

const hasValue = (env, keys) => keys.some((key) => String(env[key] || '').trim());

export const REQUIRED_CHECKS = Object.freeze({
  backupCommand: ['AURA_BACKUP_COMMAND', 'MONGODB_BACKUP_COMMAND', 'STAGING_BACKUP_COMMAND'],
  restoreCommand: ['AURA_RESTORE_COMMAND', 'MONGODB_RESTORE_COMMAND'],
  backupStorage: ['AURA_BACKUP_STORAGE_URI', 'BACKUP_BUCKET_NAME', 'STAGING_BUCKET_NAME'],
});

export const redactForOutput = (value) => {
  if (Array.isArray(value)) return value.map(redactForOutput);
  if (!value || typeof value !== 'object') return value;
  return Object.entries(value).reduce((acc, [key, entryValue]) => {
    if (/(uri|url|secret|token|password|key|command|dsn|connection)/i.test(key)) {
      acc[key] = typeof entryValue === 'boolean' ? entryValue : '[REDACTED]';
      return acc;
    }
    acc[key] = redactForOutput(entryValue);
    return acc;
  }, {});
};

export const planBackupRestoreCheck = (env = process.env) => {
  const dryRun = String(env.DRY_RUN ?? 'true').trim().toLowerCase() !== 'false';
  const targetEnvironment = String(env.RESTORE_TARGET_ENV || env.NODE_ENV || 'development').trim().toLowerCase();
  const approveProductionRestore = String(env.APPROVE_PRODUCTION_RESTORE || '').trim() === 'yes';

  const checks = {
    backupCommandConfigured: hasValue(env, REQUIRED_CHECKS.backupCommand),
    restoreCommandConfigured: hasValue(env, REQUIRED_CHECKS.restoreCommand),
    backupStorageConfigured: hasValue(env, REQUIRED_CHECKS.backupStorage),
    dryRun,
    targetEnvironment,
    approveProductionRestore,
  };

  const missing = Object.entries({
    backup_command: checks.backupCommandConfigured,
    restore_command: checks.restoreCommandConfigured,
    backup_storage: checks.backupStorageConfigured,
  })
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  const productionRestoreApproved = targetEnvironment === 'production'
    && dryRun === false
    && approveProductionRestore;
  const productionRestoreBlocked = targetEnvironment === 'production' && !productionRestoreApproved;

  if (missing.length > 0) {
    return {
      ok: false,
      blocked: true,
      reason: 'missing_backup_restore_configuration',
      missing,
      checks,
    };
  }

  if (productionRestoreBlocked) {
    return {
      ok: false,
      blocked: true,
      reason: 'production_restore_blocked',
      checks,
      requiredApproval: {
        DRY_RUN: 'false',
        APPROVE_PRODUCTION_RESTORE: 'yes',
      },
    };
  }

  return {
    ok: true,
    blocked: false,
    reason: dryRun ? 'dry_run_restore_check_allowed' : 'restore_check_allowed',
    checks,
  };
};

const main = () => {
  const result = planBackupRestoreCheck(process.env);
  console.log(JSON.stringify(redactForOutput(result), null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
