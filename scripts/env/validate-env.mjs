#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const args = process.argv.slice(2);

const getArg = (name, fallback = '') => {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1] || fallback;
  return fallback;
};

const environment = getArg('--environment', getArg('--env', 'development')).toLowerCase();
const envFile = getArg('--env-file', `config/environments/${environment}.example.env`);
const envPath = path.resolve(repoRoot, envFile);

const parseEnvFile = (contents) => {
  const parsed = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
};

if (!fs.existsSync(envPath)) {
  console.error(`env validation failed: ${envFile} does not exist`);
  process.exit(1);
}

const fileEnv = parseEnvFile(fs.readFileSync(envPath, 'utf8'));
const mergedEnv = { ...fileEnv, ...process.env };

const valueOf = (key) => String(mergedEnv[key] ?? '').trim();

const groups = [
  ['NODE_ENV', 'APP_ENV'],
];

const commonRequired = [
  'PORT',
  'APP_BASE_URL',
  'API_BASE_URL',
  'DATABASE_URL',
  'REDIS_URL',
  'OBJECT_STORAGE_BUCKET',
  'OTEL_SERVICE_NAME',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'LOG_LEVEL',
  'CORS_ORIGINS',
  'HEALTHCHECK_PATH',
];

const environmentRequired = {
  development: [],
  staging: [
    'STAGING_BASE_URL',
    'STAGING_API_BASE_URL',
    'STAGING_HEALTH_URL',
  ],
  production: [
    'PROD_BASE_URL',
    'PROD_API_BASE_URL',
    'PROD_HEALTH_URL',
  ],
};

const supportedEnvironments = new Set(Object.keys(environmentRequired));
const failures = [];

if (!supportedEnvironments.has(environment)) {
  failures.push(`Unsupported environment "${environment}". Expected one of: ${[...supportedEnvironments].join(', ')}`);
}

for (const group of groups) {
  if (!group.some((key) => valueOf(key))) {
    failures.push(`Missing one of: ${group.join(', ')}`);
  }
}

for (const key of commonRequired) {
  if (!valueOf(key)) failures.push(`Missing required variable: ${key}`);
}

for (const key of environmentRequired[environment] || []) {
  if (!valueOf(key)) failures.push(`Missing required ${environment} variable: ${key}`);
}

if (environment === 'staging') {
  const stagingHealth = valueOf('STAGING_HEALTH_URL');
  const prodUrls = [valueOf('PROD_BASE_URL'), valueOf('PROD_API_BASE_URL'), valueOf('PROD_HEALTH_URL')]
    .filter(Boolean)
    .flatMap((value) => {
      const normalized = value.replace(/\/+$/, '').toLowerCase();
      return [normalized, `${normalized}/health`];
    });
  const normalizedStagingHealth = stagingHealth.replace(/\/+$/, '').toLowerCase();
  if (prodUrls.includes(normalizedStagingHealth) || /(^|[./-])prod(uction)?([./-]|$)/i.test(stagingHealth)) {
    failures.push('STAGING_HEALTH_URL must not point at production.');
  }
}

if (valueOf('HEALTHCHECK_PATH') !== '/health') {
  failures.push('HEALTHCHECK_PATH must be /health for the public health contract.');
}

if (failures.length > 0) {
  console.error(`env validation failed for ${environment} using ${envFile}`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`env validation passed for ${environment} using ${envFile}`);
