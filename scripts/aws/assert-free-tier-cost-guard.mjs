#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import {
  currentMonthWindow,
  loadLocalAwsEnv,
  normalize,
  readJsonIfExists,
  repoRoot,
  resolveAwsRegion,
  runAwsJson,
  writeEvidence,
} from '../lib/release-guard-utils.mjs';

loadLocalAwsEnv();

const configPath = path.join(repoRoot, 'config', 'aws-free-guard.json');
const config = readJsonIfExists(configPath);
if (!config) {
  console.error('FAIL: missing config/aws-free-guard.json.');
  process.exit(1);
}

const region = normalize(config.region || process.env.AWS_REGION || resolveAwsRegion());
const failures = [];
const warnings = [];
const passes = [];

const record = (level, message) => {
  if (level === 'FAIL') failures.push(message);
  else if (level === 'WARN') warnings.push(message);
  else passes.push(message);
  console.log(`${level}: ${message}`);
};

const aws = (args, label, { critical = true } = {}) => {
  const result = runAwsJson(args);
  if (!result.ok) {
    const message = `${label} could not be checked: ${(result.stderr || result.stdout).trim()}`;
    if (critical) record('FAIL', message);
    else record('WARN', message);
    return null;
  }
  return result.data;
};

const emitEvidence = (status) => writeEvidence('cost-guard', {
  status,
  failures,
  warnings,
  passes,
  region,
  maxMonthlyUsd: config.maxMonthlyUsd,
});

const ec2Instances = aws([
  'ec2', 'describe-instances',
  '--region', region,
  '--filters', 'Name=instance-state-name,Values=running',
  '--query', "Reservations[].Instances[].{InstanceId:InstanceId,InstanceType:InstanceType,PublicIpAddress:PublicIpAddress,Tags:Tags}",
], 'running EC2 inventory');

if (ec2Instances) {
  const auraInstances = ec2Instances.filter((instance) => {
    const tags = Object.fromEntries((instance.Tags || []).map((tag) => [tag.Key, tag.Value]));
    return tags.Project === 'aura' || /^aura/i.test(tags.Name || '');
  });

  if (auraInstances.length > Number(config.maxRunningEc2 ?? 2)) {
    record('FAIL', `running Aura EC2 count ${auraInstances.length} exceeds ${config.maxRunningEc2}.`);
  } else {
    record('PASS', `running Aura EC2 count ${auraInstances.length} is within limit ${config.maxRunningEc2}.`);
  }

  const allowedTypes = new Set(config.allowedInstanceTypes || ['t2.micro', 't3.micro', 't4g.small']);
  for (const instance of auraInstances) {
    if (!allowedTypes.has(instance.InstanceType)) {
      record('FAIL', `${instance.InstanceId} uses unapproved instance type ${instance.InstanceType}.`);
    } else {
      record('PASS', `${instance.InstanceId} uses approved low-cost instance type ${instance.InstanceType}.`);
    }
  }

  const publicIpv4Count = auraInstances.filter((instance) => normalize(instance.PublicIpAddress)).length;
  if (publicIpv4Count > Number(config.maxPublicIpv4 ?? config.maxRunningEc2 ?? 2)) {
    record('FAIL', `Aura public IPv4 count ${publicIpv4Count} exceeds limit ${config.maxPublicIpv4}.`);
  } else {
    record('PASS', `Aura public IPv4 count ${publicIpv4Count} is within limit ${config.maxPublicIpv4}.`);
  }
}

const addresses = aws([
  'ec2', 'describe-addresses',
  '--region', region,
  '--query', 'Addresses[].{AllocationId:AllocationId,PublicIp:PublicIp,InstanceId:InstanceId,Tags:Tags}',
], 'Elastic IP inventory');
if (addresses) {
  if (addresses.length > Number(config.maxElasticIps ?? 1)) {
    record('FAIL', `Elastic IP count ${addresses.length} exceeds limit ${config.maxElasticIps}.`);
  } else {
    record('PASS', `Elastic IP count ${addresses.length} is within limit ${config.maxElasticIps}.`);
  }
}

const natGateways = aws([
  'ec2', 'describe-nat-gateways',
  '--region', region,
  '--filter', 'Name=state,Values=pending,available',
  '--query', 'NatGateways[].NatGatewayId',
], 'NAT Gateway inventory');
if (natGateways) {
  if (!config.allowNatGateway && natGateways.length > 0) record('FAIL', `NAT Gateways found: ${natGateways.join(', ')}.`);
  else record('PASS', 'no unexpected NAT Gateway found.');
}

const loadBalancers = aws([
  'elbv2', 'describe-load-balancers',
  '--region', region,
  '--query', 'LoadBalancers[].LoadBalancerArn',
], 'load balancer inventory');
if (loadBalancers) {
  if (!config.allowLoadBalancer && loadBalancers.length > 0) record('FAIL', `ALB/NLB resources found: ${loadBalancers.length}.`);
  else record('PASS', 'no unexpected ALB/NLB found.');
}

const rdsInstances = aws([
  'rds', 'describe-db-instances',
  '--region', region,
  '--query', 'DBInstances[].DBInstanceIdentifier',
], 'RDS inventory');
if (rdsInstances) {
  if (!config.allowPaidRds && rdsInstances.length > 0) record('FAIL', `RDS instances found: ${rdsInstances.join(', ')}.`);
  else record('PASS', 'no unexpected RDS instances found.');
}

const elasticacheClusters = aws([
  'elasticache', 'describe-cache-clusters',
  '--region', region,
  '--query', 'CacheClusters[].CacheClusterId',
], 'ElastiCache inventory');
if (elasticacheClusters) {
  if (!config.allowPaidElasticache && elasticacheClusters.length > 0) record('FAIL', `ElastiCache clusters found: ${elasticacheClusters.join(', ')}.`);
  else record('PASS', 'no unexpected ElastiCache clusters found.');
}

const opensearchDomains = aws([
  'opensearch', 'list-domain-names',
  '--region', region,
  '--query', 'DomainNames[].DomainName',
], 'OpenSearch inventory');
if (opensearchDomains) {
  if (!config.allowOpenSearch && opensearchDomains.length > 0) record('FAIL', `OpenSearch domains found: ${opensearchDomains.join(', ')}.`);
  else record('PASS', 'no unexpected OpenSearch domains found.');
}

const buckets = new Set(config.requiredBuckets || []);
for (const value of [process.env.STAGING_BUCKET_NAME, process.env.AWS_DEPLOY_BUCKET, process.env.AWS_FRONTEND_BUCKET]) {
  if (normalize(value) && normalize(value).includes('aura')) buckets.add(normalize(value));
}
for (const bucket of buckets) {
  const versioning = aws(['s3api', 'get-bucket-versioning', '--bucket', bucket], `S3 versioning for ${bucket}`);
  if (versioning) {
    if (versioning.Status !== 'Enabled') record('FAIL', `${bucket} must have versioning enabled.`);
    else record('PASS', `${bucket} has versioning enabled.`);
  }

  const lifecycle = aws(['s3api', 'get-bucket-lifecycle-configuration', '--bucket', bucket], `S3 lifecycle for ${bucket}`);
  if (lifecycle) {
    if (!Array.isArray(lifecycle.Rules) || lifecycle.Rules.length === 0) record('FAIL', `${bucket} must have lifecycle rules.`);
    else record('PASS', `${bucket} has lifecycle rules.`);
  }
}

const logGroups = aws([
  'logs', 'describe-log-groups',
  '--region', region,
  '--query', "logGroups[?contains(logGroupName, 'aura') || contains(logGroupName, 'Aura')].{Name:logGroupName,Retention:retentionInDays,StoredBytes:storedBytes}",
], 'CloudWatch log group retention');
if (logGroups) {
  for (const group of logGroups) {
    if (!group.Retention) record('FAIL', `${group.Name} has infinite CloudWatch retention.`);
    else record('PASS', `${group.Name} retention is ${group.Retention} days.`);
  }
}

const { start, end } = currentMonthWindow();
const forecast = aws([
  'ce', 'get-cost-forecast',
  '--time-period', `Start=${start},End=${end}`,
  '--metric', 'UNBLENDED_COST',
  '--granularity', 'MONTHLY',
  '--query', 'Total.Amount',
], 'Cost Explorer monthly forecast', { critical: false });
const forecastValue = forecast === null ? Number.NaN : Number(Array.isArray(forecast) ? forecast[0] : forecast);
if (Number.isFinite(forecastValue)) {
  if (forecastValue > Number(config.maxMonthlyUsd)) record('FAIL', `monthly forecast ${forecastValue.toFixed(2)} USD exceeds ${config.maxMonthlyUsd} USD.`);
  else record('PASS', `monthly forecast ${forecastValue.toFixed(2)} USD is within ${config.maxMonthlyUsd} USD.`);
} else {
  const usage = aws([
    'ce', 'get-cost-and-usage',
    '--time-period', `Start=${start},End=${end}`,
    '--granularity', 'MONTHLY',
    '--metrics', 'UnblendedCost',
    '--query', 'ResultsByTime[].Total.UnblendedCost.Amount',
  ], 'Cost Explorer month-to-date spend', { critical: false });
  if (usage !== null) {
    const amount = Number(Array.isArray(usage) ? usage[0] : usage);
    if (Number.isFinite(amount)) {
      record(amount > Number(config.maxMonthlyUsd) ? 'FAIL' : 'PASS', `month-to-date spend ${amount.toFixed(4)} USD checked against ${config.maxMonthlyUsd} USD.`);
    }
  }
}

if (failures.length > 0) {
  emitEvidence('blocked');
  console.error(`FAIL: AWS free-tier cost guard blocked release (${failures.length} failure(s)).`);
  process.exit(1);
}

emitEvidence('pass');
console.log(`PASS: AWS free-tier cost guard passed with ${warnings.length} warning(s).`);
