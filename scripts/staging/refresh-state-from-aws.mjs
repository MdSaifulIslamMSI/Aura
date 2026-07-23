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
const httpsMode = normalize(process.env.STAGING_HTTPS_MODE || 'direct').toLowerCase();

if (!['direct', 'cloudfront'].includes(httpsMode)) {
  console.error('FAIL: STAGING_HTTPS_MODE must be direct or cloudfront.');
  process.exit(1);
}

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
let newBaseUrl = `http://${instance.PublicDnsName}`;
let stateSource = 'aws-ec2-tags';
let cloudFrontState = {};

if (httpsMode === 'cloudfront') {
  const distributionId = normalize(process.env.STAGING_CLOUDFRONT_DISTRIBUTION_ID);
  const expectedPublicHost = normalize(
    process.env.STAGING_API_HOST || getUrlHost(process.env.STAGING_API_BASE_URL || process.env.STAGING_BASE_URL || '')
  ).toLowerCase();
  const expectedOriginHost = normalize(process.env.STAGING_ORIGIN_HOST).toLowerCase();
  const instanceOriginHost = `${instance.PublicIpAddress.replaceAll('.', '-')}.sslip.io`;

  if (!distributionId || !expectedPublicHost || !expectedOriginHost) {
    console.error('FAIL: CloudFront staging state requires distribution ID, public host, and origin host.');
    process.exit(1);
  }
  if (!expectedPublicHost.endsWith('.cloudfront.net')) {
    console.error('FAIL: CloudFront staging public host must use the AWS default cloudfront.net hostname.');
    process.exit(1);
  }
  if (expectedOriginHost !== instanceOriginHost) {
    console.error('FAIL: CloudFront staging origin host does not match the active staging EC2 public IP.');
    process.exit(1);
  }

  const distributionResult = runAwsJson(['cloudfront', 'get-distribution', '--id', distributionId]);
  if (!distributionResult.ok) {
    console.error(`FAIL: unable to read staging CloudFront distribution: ${distributionResult.stderr || distributionResult.stdout}`);
    process.exit(1);
  }

  const distribution = distributionResult.data?.Distribution || {};
  const distributionConfig = distribution.DistributionConfig || {};
  const status = normalize(distribution.Status);
  const distributionHost = normalize(distribution.DomainName).toLowerCase();
  const origins = distributionConfig.Origins?.Items || [];
  const originHost = normalize(origins[0]?.DomainName).toLowerCase();
  if (status !== 'Deployed') {
    console.error(`FAIL: staging CloudFront distribution is ${status || '<missing>'}, not Deployed.`);
    process.exit(1);
  }
  if (distributionConfig.Enabled !== true) {
    console.error('FAIL: staging CloudFront distribution is disabled.');
    process.exit(1);
  }
  if (distributionHost !== expectedPublicHost) {
    console.error('FAIL: staging CloudFront distribution hostname does not match STAGING_API_HOST.');
    process.exit(1);
  }
  if (origins.length !== 1 || originHost !== expectedOriginHost) {
    console.error('FAIL: staging CloudFront distribution origin does not match STAGING_ORIGIN_HOST.');
    process.exit(1);
  }

  const configuredHosts = [
    process.env.STAGING_BASE_URL,
    process.env.STAGING_FRONTEND_URL,
    process.env.STAGING_API_BASE_URL,
    process.env.STAGING_HEALTH_URL,
  ].filter(Boolean).map(getUrlHost);
  if (configuredHosts.some((host) => host !== distributionHost)) {
    console.error('FAIL: configured staging URLs do not all use the validated CloudFront hostname.');
    process.exit(1);
  }

  const tagsResult = runAwsJson(['cloudfront', 'list-tags-for-resource', '--resource', distribution.ARN]);
  if (!tagsResult.ok) {
    console.error(`FAIL: unable to read staging CloudFront tags: ${tagsResult.stderr || tagsResult.stdout}`);
    process.exit(1);
  }
  const distributionTags = Object.fromEntries(
    (tagsResult.data?.Tags?.Items || []).map((tag) => [tag.Key, tag.Value])
  );
  if (distributionTags.Environment !== 'staging') {
    console.error('FAIL: CloudFront distribution Environment tag is not staging.');
    process.exit(1);
  }
  if (distributionTags.ManagedBy !== expectedManagedBy) {
    console.error('FAIL: CloudFront distribution ManagedBy tag is not approved for staging.');
    process.exit(1);
  }
  if (distributionTags.Project !== tags.Project) {
    console.error('FAIL: CloudFront distribution Project tag does not match the staging instance.');
    process.exit(1);
  }

  newBaseUrl = `https://${distributionHost}`;
  stateSource = 'aws-cloudfront-and-ec2-tags';
  cloudFrontState = {
    cloudfront_distribution_id: distributionId,
    staging_origin_host: originHost,
  };
}
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
  ...cloudFrontState,
  staging_api_base_url: newBaseUrl,
  staging_health_url: `${newBaseUrl}/health`,
  staging_base_url: newBaseUrl,
  ssm_prefix: '/aura/staging',
  last_refreshed_at: new Date().toISOString(),
  state_source: stateSource,
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
