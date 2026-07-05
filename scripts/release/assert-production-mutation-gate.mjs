#!/usr/bin/env node
import process from 'node:process';
import {
  gitBranch,
  gitSha,
  gitStatusShort,
  isTruthy,
  normalize,
  readEvidence,
} from '../lib/release-guard-utils.mjs';

const failures = [];
const requiredPhrase = `I understand this mutates Aura production at ${gitSha()}`;
const confirmation = normalize(process.env.PRODUCTION_MUTATION_CONFIRMATION);

if (gitBranch() !== 'main') failures.push('production mutation requires branch main.');
if (gitStatusShort()) failures.push('production mutation requires a clean working tree.');
if (!isTruthy(process.env.AWS_CONTROL_PRODUCTION_MUTATIONS_ENABLED)) {
  failures.push('AWS_CONTROL_PRODUCTION_MUTATIONS_ENABLED must be explicitly true server-side.');
}
if (!normalize(process.env.PRODUCTION_MUTATION_REASON)) failures.push('operator reason is required.');
if (!normalize(process.env.GITHUB_ACTOR || process.env.USERNAME || process.env.USER)) failures.push('actor identity is required.');
if (confirmation !== requiredPhrase) failures.push(`confirmation phrase must exactly equal: ${requiredPhrase}`);

for (const [name, label] of [
  ['staging-smoke', 'staging smoke'],
  ['env-contract', 'environment contract'],
  ['cost-guard', 'cost guard'],
  ['rollback-ready', 'rollback readiness'],
]) {
  const evidence = readEvidence(name);
  if (!evidence || evidence.status !== 'pass' || evidence.gitSha !== gitSha()) {
    failures.push(`${label} evidence for current git SHA is missing.`);
  }
}

const manifest = readEvidence('release-manifest') || {};
if (!manifest.sha256 && !process.env.RELEASE_ARTIFACT_SHA256) failures.push('artifact SHA evidence is missing.');
if (!manifest.rollbackTarget && !process.env.ROLLBACK_TARGET_SHA && !process.env.ROLLBACK_ARTIFACT_URI) {
  failures.push('rollback target evidence is missing.');
}

if (failures.length > 0) {
  console.error('FAIL: production mutation gate is closed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('PASS: production mutation gate is open for this exact SHA and operator confirmation.');
