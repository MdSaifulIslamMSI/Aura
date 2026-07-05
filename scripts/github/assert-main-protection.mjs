#!/usr/bin/env node
import process from 'node:process';
import { run, runJson } from '../lib/release-guard-utils.mjs';

const repoResult = run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
if (!repoResult.ok) {
  console.error(`FAIL: unable to resolve GitHub repository: ${repoResult.stderr || repoResult.stdout}`);
  process.exit(1);
}

const repo = repoResult.stdout.trim();
let protection;
try {
  protection = runJson('gh', [
    'api',
    `repos/${repo}/branches/main/protection`,
    '--jq',
    '{required_status_checks,required_pull_request_reviews,required_conversation_resolution,restrictions,allow_force_pushes,allow_deletions}',
  ]);
} catch (error) {
  console.error(`FAIL: unable to inspect main branch protection: ${error.message}`);
  process.exit(1);
}

const failures = [];
const checks = new Set(protection?.required_status_checks?.contexts || []);
const requiredApprovals = Number.parseInt(process.env.GITHUB_MAIN_PROTECTION_REQUIRED_APPROVALS || '0', 10);
const reviewRule = protection?.required_pull_request_reviews;
const requiredChecks = [
  'test',
  'security',
  'smoke:staging',
  'smoke:staging:frontend',
  'smoke:env-contract',
  'aws:cost-guard',
  'aws:observability:guard',
  'release:rollback-ready',
];

for (const check of requiredChecks) {
  if (!checks.has(check)) failures.push(`required check missing: ${check}`);
}

if (!Number.isInteger(requiredApprovals) || requiredApprovals < 0) {
  failures.push('GITHUB_MAIN_PROTECTION_REQUIRED_APPROVALS must be a non-negative integer.');
}

if (!reviewRule) {
  failures.push('pull request review rule must be enabled to require pull requests before merge.');
} else {
  const actualApprovals = reviewRule.required_approving_review_count || 0;
  if (requiredApprovals === 0 && actualApprovals !== 0) {
    failures.push('single-owner mode must require zero approving reviews; GitHub does not allow self-approval.');
  }
  if (requiredApprovals > 0 && actualApprovals < requiredApprovals) {
    failures.push(`at least ${requiredApprovals} approving review(s) must be required.`);
  }
  if (requiredApprovals > 0 && !reviewRule.dismiss_stale_reviews) {
    failures.push('stale approvals must be dismissed after new commits.');
  }
}
if (!protection?.required_status_checks?.strict) failures.push('branch must be up to date before merge.');
if (!protection?.required_conversation_resolution?.enabled) failures.push('conversation resolution must be required.');
if (protection?.allow_force_pushes?.enabled) failures.push('force pushes must be disabled.');
if (protection?.allow_deletions?.enabled) failures.push('branch deletion must be disabled.');

if (failures.length > 0) {
  console.error('FAIL: main branch protection is incomplete');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('PASS: main branch protection matches the release gate checklist.');
