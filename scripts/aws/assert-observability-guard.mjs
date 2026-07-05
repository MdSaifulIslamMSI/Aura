#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import {
  loadLocalAwsEnv,
  normalize,
  readJsonIfExists,
  repoRoot,
  resolveAwsRegion,
  runAwsJson,
  writeEvidence,
} from '../lib/release-guard-utils.mjs';

loadLocalAwsEnv();

const config = readJsonIfExists(path.join(repoRoot, 'config', 'aws-free-guard.json')) || {};
const region = normalize(config.region || process.env.AWS_REGION || resolveAwsRegion());
const maxAlarmCount = Number(config.maxCloudWatchAlarms ?? 5);
const maxDashboardCount = Number(config.maxCloudWatchDashboards ?? 2);
const noisyLogStoredBytes = Number(config.noisyLogStoredBytesWarn ?? 250 * 1024 * 1024);

const failures = [];
const warnings = [];
const pass = [];
const note = (level, message) => {
  if (level === 'FAIL') failures.push(message);
  else if (level === 'WARN') warnings.push(message);
  else pass.push(message);
  console.log(`${level}: ${message}`);
};

const aws = (args, label, critical = true) => {
  const result = runAwsJson(args);
  if (!result.ok) {
    const message = `${label} could not be checked: ${(result.stderr || result.stdout).trim()}`;
    note(critical ? 'FAIL' : 'WARN', message);
    return null;
  }
  return result.data;
};

const emitEvidence = (status) => writeEvidence('observability-guard', {
  status,
  region,
  failures,
  warnings,
  pass,
});

const groups = aws([
  'logs', 'describe-log-groups',
  '--region', region,
  '--query', "logGroups[?contains(logGroupName, 'aura') || contains(logGroupName, 'Aura')].{Name:logGroupName,Retention:retentionInDays,StoredBytes:storedBytes}",
], 'CloudWatch log groups');

if (groups) {
  for (const group of groups) {
    if (!group.Retention) note('FAIL', `${group.Name} has infinite log retention.`);
    else note('PASS', `${group.Name} retention is ${group.Retention} days.`);
    if (Number(group.StoredBytes || 0) > noisyLogStoredBytes) {
      note('WARN', `${group.Name} stores ${group.StoredBytes} bytes; inspect for noisy logs.`);
    }
  }
}

const alarms = aws([
  'cloudwatch', 'describe-alarms',
  '--region', region,
  '--query', "MetricAlarms[?contains(AlarmName, 'aura') || contains(AlarmName, 'Aura')].AlarmName",
], 'CloudWatch alarms', false);
if (alarms) {
  if (alarms.length > maxAlarmCount) note('WARN', `Aura alarm count ${alarms.length} exceeds free-safe target ${maxAlarmCount}.`);
  else note('PASS', `Aura alarm count ${alarms.length} is within free-safe target ${maxAlarmCount}.`);
}

const dashboards = aws([
  'cloudwatch', 'list-dashboards',
  '--region', region,
  '--query', "DashboardEntries[?contains(DashboardName, 'aura') || contains(DashboardName, 'Aura')].DashboardName",
], 'CloudWatch dashboards', false);
if (dashboards) {
  if (dashboards.length > maxDashboardCount) note('WARN', `Aura dashboard count ${dashboards.length} exceeds free-safe target ${maxDashboardCount}.`);
  else note('PASS', `Aura dashboard count ${dashboards.length} is within free-safe target ${maxDashboardCount}.`);
}

if (failures.length > 0) {
  emitEvidence('blocked');
  console.error(`FAIL: observability guard blocked release (${failures.length} failure(s)).`);
  process.exit(1);
}

emitEvidence('pass');
console.log(`PASS: observability guard passed with ${warnings.length} warning(s).`);
