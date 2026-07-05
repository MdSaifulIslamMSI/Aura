#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import {
  PRODUCTION_SSM_PREFIX,
  STAGING_SSM_PREFIX,
  isKnownProductionHost,
  isTruthy,
  looksProductionLike,
  normalize,
} from '../env-contract-lib.mjs';

const REQUIRED_PROFILE = 'aura-staging-operator';

const REQUIRED_ENV = [
  ['AWS_PROFILE', `must be ${REQUIRED_PROFILE}`],
  ['AWS_REGION', 'is required for staging AWS checks'],
  ['SMOKE_TARGET_ENV', 'must be staging'],
  ['SMOKE_BASE_URL', 'is required and must equal STAGING_BASE_URL'],
  ['STAGING_BASE_URL', 'is required for staging smoke'],
  ['STAGING_FRONTEND_URL', 'is required for frontend staging smoke'],
  ['STAGING_API_BASE_URL', 'is required for staging backend smoke'],
  ['STAGING_HEALTH_URL', 'is required for staging health smoke'],
  ['STAGING_SSM_PREFIX', `must be ${STAGING_SSM_PREFIX}`],
  ['SMOKE_REQUIRE_BACKEND_STAGING', 'must be true'],
  ['SMOKE_FORBID_PRODUCTION_ORIGINS', 'must be true'],
  ['PROD_BASE_URL', 'is required as a production comparison URL'],
  ['PROD_API_BASE_URL', 'is required as a production comparison URL'],
  ['PROD_SSM_PREFIX', `must be ${PRODUCTION_SSM_PREFIX}`],
];

const STAGING_URL_ENV = [
  'SMOKE_BASE_URL',
  'STAGING_BASE_URL',
  'STAGING_FRONTEND_URL',
  'STAGING_API_BASE_URL',
  'STAGING_HEALTH_URL',
];

const normalizeUrl = (value = '') => normalize(value).replace(/\/+$/, '');

const commandFromPath = (awsPath) => {
  if (!awsPath) return { command: 'aws', prefixArgs: [] };
  if (process.platform !== 'win32') return { command: awsPath, prefixArgs: [] };

  const extension = path.extname(awsPath).toLowerCase();
  if (extension === '.cmd' || extension === '.bat') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      prefixArgs: ['/d', '/s', '/c', awsPath],
    };
  }

  return { command: awsPath, prefixArgs: [] };
};

const resolveAwsCommand = () => {
  const explicitAwsPath = normalize(process.env.AWS_CLI_PATH);
  if (explicitAwsPath) return commandFromPath(explicitAwsPath);

  if (process.platform !== 'win32') return { command: 'aws', prefixArgs: [] };

  const resolved = spawnSync('where.exe', ['aws'], {
    encoding: 'utf8',
    shell: false,
    env: process.env,
  });
  if (resolved.status !== 0) return { command: 'aws', prefixArgs: [] };

  const awsPath = (resolved.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0];
  return commandFromPath(awsPath);
};

const runAws = (args) => {
  const { command, prefixArgs } = resolveAwsCommand();
  return spawnSync(command, [...prefixArgs, ...args], {
    encoding: 'utf8',
    shell: false,
    env: process.env,
  });
};

const valuesEqual = (left = '', right = '') => {
  const normalizedLeft = normalizeUrl(left);
  const normalizedRight = normalizeUrl(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
};

const validateEnvironment = (env = process.env) => {
  const missing = [];
  const unsafe = [];

  for (const [name, reason] of REQUIRED_ENV) {
    if (!normalize(env[name])) missing.push(`${name} ${reason}.`);
  }

  if (normalize(env.AWS_PROFILE) && normalize(env.AWS_PROFILE) !== REQUIRED_PROFILE) {
    unsafe.push(`AWS_PROFILE must be ${REQUIRED_PROFILE}.`);
  }
  if (normalize(env.SMOKE_TARGET_ENV) && normalize(env.SMOKE_TARGET_ENV) !== 'staging') {
    unsafe.push('SMOKE_TARGET_ENV must be staging.');
  }
  if (normalize(env.STAGING_SSM_PREFIX) && normalize(env.STAGING_SSM_PREFIX) !== STAGING_SSM_PREFIX) {
    unsafe.push(`STAGING_SSM_PREFIX must be ${STAGING_SSM_PREFIX}.`);
  }
  if (normalize(env.PROD_SSM_PREFIX) && normalize(env.PROD_SSM_PREFIX) !== PRODUCTION_SSM_PREFIX) {
    unsafe.push(`PROD_SSM_PREFIX must be ${PRODUCTION_SSM_PREFIX}.`);
  }
  if (normalize(env.SMOKE_REQUIRE_BACKEND_STAGING) && !isTruthy(env.SMOKE_REQUIRE_BACKEND_STAGING)) {
    unsafe.push('SMOKE_REQUIRE_BACKEND_STAGING must be true.');
  }
  if (normalize(env.SMOKE_FORBID_PRODUCTION_ORIGINS) && !isTruthy(env.SMOKE_FORBID_PRODUCTION_ORIGINS)) {
    unsafe.push('SMOKE_FORBID_PRODUCTION_ORIGINS must be true.');
  }
  if (normalize(env.SMOKE_BASE_URL) && normalize(env.STAGING_BASE_URL) && !valuesEqual(env.SMOKE_BASE_URL, env.STAGING_BASE_URL)) {
    unsafe.push('SMOKE_BASE_URL must equal STAGING_BASE_URL.');
  }

  const productionComparisonUrls = [
    env.PROD_BASE_URL,
    env.PROD_API_BASE_URL,
  ].map(normalizeUrl).filter(Boolean);

  for (const name of STAGING_URL_ENV) {
    const value = normalize(env[name]);
    if (!value) continue;
    if (
      isKnownProductionHost(value)
      || looksProductionLike(value)
      || productionComparisonUrls.some((productionUrl) => normalizeUrl(value) === productionUrl)
    ) {
      unsafe.push(`${name} must not point to a production or production-like URL.`);
    }
  }

  return { missing, unsafe };
};

const validateAwsCli = () => {
  const version = runAws(['--version']);
  if (version.error?.code === 'ENOENT' || version.status !== 0) {
    return {
      ok: false,
      message: 'AWS CLI is not available on PATH.',
    };
  }
  return { ok: true };
};

const validateAwsIdentity = () => {
  const identity = runAws(['sts', 'get-caller-identity', '--output', 'json']);
  if (identity.status !== 0) {
    return {
      ok: false,
      message: `AWS STS identity check failed. Run aws sso login --profile ${REQUIRED_PROFILE}.`,
    };
  }

  try {
    const parsed = JSON.parse(identity.stdout || '{}');
    if (!parsed.Arn || !parsed.Account) {
      return {
        ok: false,
        message: 'AWS STS identity response was incomplete.',
      };
    }
  } catch {
    return {
      ok: false,
      message: 'AWS STS identity response was not valid JSON.',
    };
  }

  return { ok: true };
};

const printList = (heading, items) => {
  if (items.length === 0) return;
  console.error(heading);
  for (const item of items) console.error(`- ${item}`);
};

export const checkLocalReleaseCredentials = ({ env = process.env } = {}) => {
  const failures = [];
  const { missing, unsafe } = validateEnvironment(env);
  const cli = validateAwsCli();
  if (!cli.ok) failures.push(cli.message);

  const canCheckIdentity = cli.ok && normalize(env.AWS_PROFILE) === REQUIRED_PROFILE;
  if (canCheckIdentity) {
    const identity = validateAwsIdentity();
    if (!identity.ok) failures.push(identity.message);
  } else if (cli.ok && normalize(env.AWS_PROFILE)) {
    failures.push(`AWS STS identity check skipped because AWS_PROFILE is not ${REQUIRED_PROFILE}.`);
  }

  return { failures, missing, unsafe };
};

const result = checkLocalReleaseCredentials();

if (result.failures.length > 0 || result.missing.length > 0 || result.unsafe.length > 0) {
  console.error('local-release-credentials: failed');
  printList('Missing required items:', result.missing);
  printList('Unsafe credential or staging configuration:', [...result.failures, ...result.unsafe]);
  process.exit(1);
}

console.log('local-release-credentials: passed');
console.log('AWS CLI: available');
console.log('AWS STS identity: reachable');
console.log('Staging environment: required variable names present');
console.log(`SSM prefix: ${STAGING_SSM_PREFIX}`);
