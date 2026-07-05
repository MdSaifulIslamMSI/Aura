#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  normalize,
  readJsonIfExists,
  repoRoot,
  runAws,
  writeEvidence,
} from '../lib/release-guard-utils.mjs';

const failures = [];
const warnings = [];
const pass = [];
const note = (level, message) => {
  if (level === 'FAIL') failures.push(message);
  else if (level === 'WARN') warnings.push(message);
  else pass.push(message);
  console.log(`${level}: ${message}`);
};

const runbook = path.join(repoRoot, 'docs', 'runbooks', 'aws-production-rollback.md');
const rollbackHook = path.join(repoRoot, 'infra', 'aws', 'rollback-backend.sh');
if (!fs.existsSync(runbook)) note('FAIL', 'docs/runbooks/aws-production-rollback.md is required.');
else note('PASS', 'AWS production rollback runbook exists.');
if (!fs.existsSync(rollbackHook)) note('FAIL', 'infra/aws/rollback-backend.sh is required.');
else note('PASS', 'backend rollback hook exists.');

const manifest = readJsonIfExists(path.join(repoRoot, 'artifacts', 'release-manifests', 'latest.json')) || {};
const rollbackTarget = normalize(process.env.ROLLBACK_TARGET_SHA || manifest.rollbackTarget || process.env.ROLLBACK_ARTIFACT_URI);
const deployBucket = normalize(process.env.AWS_DEPLOY_BUCKET);
const rollbackArtifactUri = normalize(
  process.env.ROLLBACK_ARTIFACT_URI
  || manifest.rollbackArtifactUri
  || (deployBucket && rollbackTarget ? `s3://${deployBucket}/releases/${rollbackTarget}/` : '')
);
const prodHealthUrl = normalize(process.env.PROD_HEALTH_URL || process.env.PROD_API_BASE_URL || process.env.AURA_BACKEND_ORIGIN);

if (!rollbackTarget && !rollbackArtifactUri) {
  note('FAIL', 'previous good artifact evidence is required via ROLLBACK_TARGET_SHA, ROLLBACK_ARTIFACT_URI, or latest release manifest.');
} else {
  note('PASS', 'previous good artifact evidence is configured.');
}

if (!prodHealthUrl) note('FAIL', 'production health URL is required via PROD_HEALTH_URL, PROD_API_BASE_URL, or AURA_BACKEND_ORIGIN.');
else note('PASS', 'production health URL is known.');

const runbookText = fs.existsSync(runbook) ? fs.readFileSync(runbook, 'utf8') : '';
for (const required of [
  'rollback does not rebuild from source',
  'do not print secrets',
  'service worker',
  'retry loops',
  'incident notes',
]) {
  if (!runbookText.toLowerCase().includes(required)) {
    note('FAIL', `rollback runbook must mention: ${required}.`);
  }
}

if (rollbackArtifactUri.startsWith('s3://')) {
  const withoutScheme = rollbackArtifactUri.slice('s3://'.length);
  const slash = withoutScheme.indexOf('/');
  const bucket = withoutScheme.slice(0, slash);
  const key = withoutScheme.slice(slash + 1);
  if (!bucket || !key) {
    note('FAIL', 'rollback S3 URI must include bucket and key or release prefix.');
  } else if (key.endsWith('/')) {
    const listing = runAws(['s3', 'ls', `s3://${bucket}/${key}`]);
    if (!listing.ok) {
      note('FAIL', `rollback release prefix could not be listed in S3: ${(listing.stderr || listing.stdout).trim()}`);
    } else {
      const text = listing.stdout;
      if (!/\sinfra\.tar\.gz\b/.test(text)) note('FAIL', 'rollback release prefix is missing infra.tar.gz.');
      if (!/\simage\.tar\.gz\b/.test(text)) note('FAIL', 'rollback release prefix is missing image.tar.gz.');
      if (/\sinfra\.tar\.gz\b/.test(text) && /\simage\.tar\.gz\b/.test(text)) {
        note('PASS', 'rollback release prefix contains infra.tar.gz and image.tar.gz.');
      }
    }
  } else {
    const result = runAws(['s3api', 'head-object', '--bucket', bucket, '--key', key]);
    if (result.ok) {
      note('PASS', 'rollback artifact exists in S3.');
    } else {
      const listing = runAws(['s3', 'ls', `s3://${bucket}/${key}`]);
      if (listing.ok && listing.stdout.trim()) note('PASS', 'rollback artifact exists in S3 via prefix listing.');
      else note('FAIL', `rollback artifact could not be verified in S3: ${(result.stderr || result.stdout).trim()}`);
    }
  }
} else if (rollbackArtifactUri) {
  note('WARN', 'rollback artifact URI is not S3; existence was not checked automatically.');
}

if (failures.length > 0) {
  console.error(`FAIL: rollback readiness blocked release (${failures.length} failure(s)).`);
  process.exit(1);
}

writeEvidence('rollback-ready', { status: 'pass', rollbackTarget, rollbackArtifactUri, warnings, pass });
console.log(`PASS: rollback readiness passed with ${warnings.length} warning(s).`);
