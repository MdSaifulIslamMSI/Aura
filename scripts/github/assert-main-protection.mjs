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
const warnings = [];
const checks = new Set(protection?.required_status_checks?.contexts || []);
const requiredApprovals = Number.parseInt(process.env.GITHUB_MAIN_PROTECTION_REQUIRED_APPROVALS || '0', 10);
const reviewRule = protection?.required_pull_request_reviews;
// The required status checks actually configured on main. The doctor enforces
// these so protection cannot silently lose them.
const enforcedChecks = [
  'Quality, tests, and coverage',
  'javascript-typescript',
  'security',
  'build-and-smoke',
];
// Emitted on PRs by .github/workflows/giant-release-gates.yml. Promotion into
// required_status_checks is desirable once live staging runs continuously
// again (the smoke/latency/rollback gates need a running staging environment).
const promotableChecks = [
  'test',
  'smoke:staging',
  'smoke:staging:frontend',
  'smoke:env-contract',
  'aws:cost-guard',
  'aws:observability:guard',
  'sre:synthetic:staging',
  'sre:latency:staging',
  'test:reliability',
  'release:rollback-ready',
];

for (const check of enforcedChecks) {
  if (!checks.has(check)) failures.push(`required check missing: ${check}`);
}
for (const check of promotableChecks) {
  if (!checks.has(check)) warnings.push(`promotion candidate not yet required: ${check}`);
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
if (!protection?.required_status_checks?.strict) warnings.push('branch is not required to be up to date before merge (strict=false).');
if (!protection?.required_conversation_resolution?.enabled) warnings.push('conversation resolution is not required.');
if (protection?.allow_force_pushes?.enabled) failures.push('force pushes must be disabled.');
if (protection?.allow_deletions?.enabled) failures.push('branch deletion must be disabled.');

if (warnings.length > 0) {
  console.warn('WARN: main branch protection has promotion candidates and gaps:');
  for (const warning of warnings) console.warn(`- ${warning}`);
}

if (failures.length > 0) {
  console.error('FAIL: main branch protection is incomplete');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('PASS: main branch protection matches the release gate checklist.');
