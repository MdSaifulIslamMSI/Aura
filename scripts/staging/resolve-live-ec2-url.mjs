#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const trim = (value) => String(value || '').trim();
const trimTrailingSlash = (value) => trim(value).replace(/\/+$/, '');

const env = process.env;

const isEc2ComputeUrl = (value) => {
  try {
    const { hostname } = new URL(value);
    return /^ec2-\d+-\d+-\d+-\d+\.[a-z0-9-]+\.compute\.amazonaws\.com$/i.test(hostname);
  } catch {
    return false;
  }
};

const parseInstanceFromEnv = () => {
  const raw = trim(env.STAGING_EC2_INSTANCE_JSON || env.AURA_STAGING_INSTANCE_JSON || '');
  if (!raw) return null;
  return JSON.parse(raw);
};

const resolveInstanceWithAwsCli = () => {
  const region = trim(env.AWS_REGION || env.AWS_DEFAULT_REGION);
  if (!region) throw new Error('AWS_REGION is required to resolve live staging EC2 URLs.');

  const projectName = trim(env.PROJECT_NAME) || 'aura';
  const stagingName = trim(env.STAGING_NAME) || 'staging';
  const managedBy = trim(env.STAGING_MANAGED_BY) || 'codex-staging-bootstrap';

  const stdout = execFileSync('aws', [
    'ec2',
    'describe-instances',
    '--region',
    region,
    '--filters',
    `Name=tag:Project,Values=${projectName}`,
    `Name=tag:Environment,Values=${stagingName}`,
    `Name=tag:ManagedBy,Values=${managedBy}`,
    'Name=instance-state-name,Values=running',
    '--query',
    'Reservations[].Instances[]',
    '--output',
    'json',
  ], { encoding: 'utf8' });

  const instances = JSON.parse(stdout);
  if (!Array.isArray(instances) || instances.length !== 1) {
    throw new Error(`Expected exactly one running staging EC2 instance, found ${Array.isArray(instances) ? instances.length : 0}.`);
  }
  return instances[0];
};

const instance = parseInstanceFromEnv() || resolveInstanceWithAwsCli();
const publicDns = trim(instance.PublicDnsName || instance.publicDns || instance.public_dns);

if (!publicDns) {
  throw new Error('Resolved staging EC2 instance is missing PublicDnsName.');
}
if (!/^ec2-\d+-\d+-\d+-\d+\.[a-z0-9-]+\.compute\.amazonaws\.com$/i.test(publicDns)) {
  throw new Error(`Refusing non-EC2 staging public DNS: ${publicDns}`);
}

const liveBaseUrl = `http://${publicDns}`;
const currentBaseUrl = trimTrailingSlash(env.STAGING_BASE_URL);
const currentFrontendUrl = trimTrailingSlash(env.STAGING_FRONTEND_URL);
const preserveFrontend = Boolean(
  currentFrontendUrl
  && currentFrontendUrl !== currentBaseUrl
  && !isEc2ComputeUrl(currentFrontendUrl)
);
const resolved = {
  STAGING_BASE_URL: liveBaseUrl,
  STAGING_API_BASE_URL: liveBaseUrl,
  STAGING_HEALTH_URL: `${liveBaseUrl}/health`,
  STAGING_FRONTEND_URL: preserveFrontend ? currentFrontendUrl : liveBaseUrl,
  SMOKE_BASE_URL: liveBaseUrl,
};

const lines = Object.entries(resolved).map(([key, value]) => `${key}=${value}`);
if (env.GITHUB_ENV) {
  appendFileSync(env.GITHUB_ENV, `${lines.join('\n')}\n`);
}

if (env.GITHUB_OUTPUT) {
  appendFileSync(env.GITHUB_OUTPUT, `base_url=${resolved.STAGING_BASE_URL}\n`);
  appendFileSync(env.GITHUB_OUTPUT, `frontend_url=${resolved.STAGING_FRONTEND_URL}\n`);
}

console.log('Resolved live staging EC2 URLs.');
console.log(`base=${resolved.STAGING_BASE_URL}`);
console.log(`frontend=${resolved.STAGING_FRONTEND_URL}`);
