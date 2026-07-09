#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const REQUIRED_PROFILE = 'aura-staging-operator';
const DEFAULT_REGION = 'ap-south-1';

const REQUIRED_ENV = [
  ['AURA_AWS_SSO_START_URL', 'IAM Identity Center start URL'],
  ['AURA_AWS_SSO_REGION', 'IAM Identity Center home region'],
  ['AURA_AWS_SSO_ACCOUNT_ID', 'staging AWS account ID'],
  ['AURA_AWS_SSO_ROLE_NAME', 'staging release-gate permission-set role name'],
];

const normalize = (value = '') => String(value).trim();

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

const collectInput = (env = process.env) => ({
  ssoStartUrl: normalize(env.AURA_AWS_SSO_START_URL),
  ssoRegion: normalize(env.AURA_AWS_SSO_REGION),
  ssoAccountId: normalize(env.AURA_AWS_SSO_ACCOUNT_ID),
  ssoRoleName: normalize(env.AURA_AWS_SSO_ROLE_NAME),
  region: normalize(env.AWS_REGION) || DEFAULT_REGION,
});

const validateInput = (input, env = process.env) => {
  const failures = [];
  for (const [name, label] of REQUIRED_ENV) {
    if (!normalize(env[name])) failures.push(`${name} is required (${label}).`);
  }

  try {
    const parsed = new URL(input.ssoStartUrl);
    if (parsed.protocol !== 'https:') failures.push('AURA_AWS_SSO_START_URL must be an HTTPS URL.');
  } catch {
    if (input.ssoStartUrl) failures.push('AURA_AWS_SSO_START_URL must be a valid URL.');
  }

  if (input.ssoAccountId && !/^\d{12}$/.test(input.ssoAccountId)) {
    failures.push('AURA_AWS_SSO_ACCOUNT_ID must be a 12-digit AWS account ID.');
  }
  if (input.ssoRegion && !/^[a-z]{2}-[a-z-]+-\d$/.test(input.ssoRegion)) {
    failures.push('AURA_AWS_SSO_REGION must be an AWS region such as us-east-1.');
  }
  if (input.region && !/^[a-z]{2}-[a-z-]+-\d$/.test(input.region)) {
    failures.push('AWS_REGION must be an AWS region such as ap-south-1.');
  }
  if (input.ssoRoleName && !/^[A-Za-z0-9+=,.@_-]{1,128}$/.test(input.ssoRoleName)) {
    failures.push('AURA_AWS_SSO_ROLE_NAME contains unsupported characters.');
  }

  return failures;
};

const validateAwsCli = () => {
  const version = runAws(['--version']);
  if (version.error?.code === 'ENOENT' || version.status !== 0) {
    return 'AWS CLI is not available on PATH.';
  }
  return '';
};

const readAwsProfileValue = (key) => {
  const result = runAws(['configure', 'get', key, '--profile', REQUIRED_PROFILE]);
  if (result.status !== 0) return '';
  return normalize(result.stdout);
};

const validateExistingProfileShape = () => {
  const forbiddenSourceKeys = [
    'source_profile',
    'role_arn',
    'credential_source',
    'credential_process',
  ].filter((key) => readAwsProfileValue(key));

  if (forbiddenSourceKeys.length === 0) return '';
  return `${REQUIRED_PROFILE} already has static-key or role-source fields. Remove that local profile section before creating the SSO profile.`;
};

const setAwsProfileValue = (key, value) => {
  const result = runAws(['configure', 'set', key, value, '--profile', REQUIRED_PROFILE]);
  if (result.status === 0) return '';
  return `Failed to write AWS profile setting ${key}.`;
};

export const setupLocalReleaseSsoProfile = ({ env = process.env } = {}) => {
  const input = collectInput(env);
  const failures = [
    ...validateInput(input, env),
    validateAwsCli(),
  ].filter(Boolean);

  if (failures.length === 0) {
    const existingProfileFailure = validateExistingProfileShape();
    if (existingProfileFailure) failures.push(existingProfileFailure);
  }

  if (failures.length > 0) return { ok: false, failures };

  const writes = [
    ['sso_start_url', input.ssoStartUrl],
    ['sso_region', input.ssoRegion],
    ['sso_account_id', input.ssoAccountId],
    ['sso_role_name', input.ssoRoleName],
    ['region', input.region],
    ['output', 'json'],
  ];

  const writeFailures = writes.map(([key, value]) => setAwsProfileValue(key, value)).filter(Boolean);
  if (writeFailures.length > 0) return { ok: false, failures: writeFailures };

  return { ok: true, failures: [] };
};

const result = setupLocalReleaseSsoProfile();

if (!result.ok) {
  console.error('local-release-sso-profile: failed');
  console.error('Missing or unsafe setup items:');
  for (const failure of result.failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('local-release-sso-profile: configured');
console.log(`AWS profile: ${REQUIRED_PROFILE}`);
console.log('Credential source: AWS SSO/IAM Identity Center');
console.log(`Next: aws sso login --profile ${REQUIRED_PROFILE}`);
