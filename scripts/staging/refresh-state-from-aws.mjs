#!/usr/bin/env node
import process from 'node:process';
import {
  getUrlHost,
  loadLocalAwsEnv,
  normalize,
  normalizeUrl,
  readJsonIfExists,
  repoRoot,
  resolveAwsRegion,
  runAwsJson,
  writeJsonAtomic,
} from '../lib/release-guard-utils.mjs';
import { stateFile } from './state-env.mjs';

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const expectedManagedBy = normalize(process.env.STAGING_EXPECTED_MANAGED_BY || 'codex-staging-bootstrap');

loadLocalAwsEnv();

const region = resolveAwsRegion();
const result = runAwsJson([
  'ec2',
  'describe-instances',
  '--region',
  region,
  '--filters',
  'Name=tag:Environment,Values=staging',
  'Name=instance-state-name,Values=running',
  '--query',
  "Reservations[].Instances[].{InstanceId:InstanceId,PublicDnsName:PublicDnsName,PublicIpAddress:PublicIpAddress,InstanceType:InstanceType,LaunchTime:LaunchTime,Tags:Tags}",
]);

if (!result.ok) {
  console.error(`FAIL: unable to read staging EC2 state: ${result.stderr || result.stdout}`);
  process.exit(1);
}

const instances = result.data || [];
if (instances.length === 0) {
  console.error('FAIL: no running EC2 instance has Environment=staging.');
  process.exit(1);
}
if (instances.length > 1) {
  console.error(`FAIL: refusing to write because more than one active staging instance was found (${instances.length}).`);
  for (const instance of instances) console.error(`- ${instance.InstanceId || '<unknown>'}`);
  process.exit(1);
}

const instance = instances[0];
const tags = Object.fromEntries((instance.Tags || []).map((tag) => [tag.Key, tag.Value]));
if (tags.Environment !== 'staging') {
  console.error(`FAIL: refusing to write state because Environment tag is ${tags.Environment || '<missing>'}.`);
  process.exit(1);
}
if (tags.ManagedBy !== expectedManagedBy) {
  console.error(`FAIL: refusing to write state because ManagedBy tag is ${tags.ManagedBy || '<missing>'}.`);
  process.exit(1);
}
if (!instance.PublicDnsName || !instance.PublicIpAddress) {
  console.error('FAIL: staging instance is missing PublicDnsName or PublicIpAddress.');
  process.exit(1);
}

const oldState = readJsonIfExists(stateFile) || {};
const oldHost = getUrlHost(oldState.staging_api_base_url || oldState.staging_base_url || oldState.public_dns || '');
const newBaseUrl = `http://${instance.PublicDnsName}`;
const newHost = getUrlHost(newBaseUrl);
const oldFrontend = normalizeUrl(oldState.staging_frontend_url || '');
const oldFrontendHost = getUrlHost(oldFrontend);
const oldPublicIp = normalize(oldState.public_ip);
const shouldMoveFrontend = !oldFrontend
  || oldFrontendHost === oldHost
  || oldFrontendHost.startsWith('ec2-')
  || oldFrontend.includes(oldPublicIp);

const nextState = {
  ...oldState,
  instance_id: instance.InstanceId,
  instance_type: instance.InstanceType,
  public_dns: instance.PublicDnsName,
  public_ip: instance.PublicIpAddress,
  staging_api_base_url: newBaseUrl,
  staging_health_url: `${newBaseUrl}/health`,
  staging_base_url: newBaseUrl,
  ssm_prefix: '/aura/staging',
  last_refreshed_at: new Date().toISOString(),
  state_source: 'aws-ec2-tags',
};

if (shouldMoveFrontend) {
  nextState.staging_frontend_url = newBaseUrl;
}

console.log(`old staging host: ${oldHost || '<missing>'}`);
console.log(`new staging host: ${newHost}`);
console.log(`staging instance: ${instance.InstanceId}`);
console.log(`managed by: ${tags.ManagedBy}`);

const stale = oldHost && oldHost !== newHost;
if (checkOnly) {
  if (!oldHost) {
    console.error('FAIL: .staging/state.json has no staging host; run npm run staging:state:refresh.');
    process.exit(1);
  }
  if (stale) {
    console.error('FAIL: .staging/state.json is stale; run npm run staging:state:refresh.');
    process.exit(1);
  }
  console.log('PASS: .staging/state.json matches the active AWS staging instance.');
  process.exit(0);
}

writeJsonAtomic(stateFile, nextState);
console.log(stale ? 'PASS: refreshed stale .staging/state.json.' : 'PASS: .staging/state.json is current.');
console.log(`state file: ${stateFile.replace(`${repoRoot}\\`, '')}`);
