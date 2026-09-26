#!/usr/bin/env node
// Policy-driven auto-merge controller for Dependabot pull requests.
//
// Two entry points:
//   --pr <number>   event path: classify one PR (GH_PR_NUMBER also accepted)
//   --sweep         scheduled path: classify every open Dependabot PR
//   --dry-run       log decisions, take no mutating action
//   --self-test     run the classifier assertions, touch nothing
//
// Policy (config/dependency-policy.json):
//   - patch/minor bumps -> auto-merge (squash) once armed
//   - major bumps -> auto-merge unless the dep matches majorBlocklist
//   - any `overrides` change -> needs-human (cross-manifest pin seams are hand-synced)
//   - PRs without package.json changes (actions/docker bumps) -> tooling, safe lane
//
// The controller never bypasses branch protection: it only arms GitHub
// auto-merge, which itself waits for the required status checks to pass.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POLICY_PATH = path.join(REPO_ROOT, 'config', 'dependency-policy.json');
// GraphQL reports the Dependabot app as "app/dependabot", REST as "dependabot[bot]".
const DEPENDABOT_ACTOR = 'app/dependabot';
const DEPENDABOT_LOGINS = new Set(['app/dependabot', 'dependabot[bot]']);

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run') || process.env.DRY_RUN === '1';

function gh(...params) {
  return execFileSync('gh', params, {
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN },
    maxBuffer: 32 * 1024 * 1024,
  });
}

const TRANSIENT_ERROR = /network|timed out|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|rate limit|502|503|504/i;

// Same call as gh(), but retries transient api.github.com blips with a short
// linear backoff. Mutating calls that are not idempotent (pr comment) must use
// plain gh() instead.
function ghRetry(...params) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return gh(...params);
    } catch (error) {
      lastError = error;
      if (!TRANSIENT_ERROR.test(error.message) || attempt === 3) break;
      log(`transient failure (attempt ${attempt}/3): ${error.message.split('\n')[0]} — retrying`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500 * attempt);
    }
  }
  throw lastError;
}

function ghJsonRetry(...params) {
  return JSON.parse(ghRetry(...params));
}

function log(...parts) {
  console.log('[dep-automerge]', ...parts);
}

function loadPolicy() {
  return JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
}

function ensureLabel(name, color, description, dryRun) {
  if (dryRun) return;
  gh('label', 'create', name, '--color', color, '--description', description, '--force');
}

// Pull the leading version triple out of a range like ^1.2.3, ~2.0.0, >=3.1.4, 7.6.0.
function leadingVersion(range) {
  const match = String(range ?? '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function classifyRangeChange(fromRange, toRange) {
  const from = leadingVersion(fromRange);
  const to = leadingVersion(toRange);
  if (!from || !to) return 'unknown';
  if (from.major !== to.major) return 'major';
  if (from.minor !== to.minor) return 'minor';
  return 'patch';
}

function canonical(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  const sorted = {};
  for (const key of Object.keys(value).sort()) sorted[key] = canonical(value[key]);
  return sorted;
}

function manifestDelta(baseManifest, headManifest) {
  const sections = ['dependencies', 'devDependencies', 'optionalDependencies'];
  const changed = [];
  for (const section of sections) {
    const base = baseManifest?.[section] ?? {};
    const head = headManifest?.[section] ?? {};
    const names = new Set([...Object.keys(base), ...Object.keys(head)]);
    for (const name of names) {
      if ((base[name] ?? null) === (head[name] ?? null)) continue;
      const kind =
        base[name] === undefined ? 'added' : head[name] === undefined ? 'removed' : classifyRangeChange(base[name], head[name]);
      changed.push({ name, section, from: base[name] ?? '(new)', to: head[name] ?? '(gone)', kind });
    }
  }
  const overridesChanged =
    JSON.stringify(canonical(baseManifest?.overrides ?? null)) !== JSON.stringify(canonical(headManifest?.overrides ?? null));
  return { changed, overridesChanged };
}

function matchesBlocklist(name, blocklist) {
  return blocklist.some((pattern) => {
    if (pattern.endsWith('*')) return name.startsWith(pattern.slice(0, -1));
    return name === pattern;
  });
}

function fetchManifest(owner, repo, manifestPath, ref) {
  const raw = ghRetry(
    'api',
    '-H',
    'Accept: application/vnd.github.raw',
    `repos/${owner}/${repo}/contents/${manifestPath}?ref=${ref}`
  );
  return JSON.parse(raw);
}

function decide(policy, delta) {
  const blocked = [];
  if (delta.overridesChanged) {
    blocked.push('manifest `overrides` changed — cross-workspace pin seams are hand-synced');
  }
  for (const dep of delta.changed) {
    if (dep.kind === 'major' && matchesBlocklist(dep.name, policy.automerge.majorBlocklist)) {
      blocked.push(`${dep.name} ${dep.from} → ${dep.to} (major, risk blocklist)`);
    }
  }
  if (blocked.length > 0) {
    return { lane: 'risk', blocked };
  }
  return { lane: 'safe', blocked: [] };
}

function failedChecks(pr) {
  const rollup = pr.statusCheckRollup ?? [];
  return rollup.filter((check) => check.conclusion === 'FAILURE' || check.conclusion === 'ACTION_REQUIRED');
}

function armAutoMerge(pr, dryRun) {
  if (pr.autoMergeRequest) {
    log(`PR #${pr.number}: auto-merge already armed (${pr.autoMergeRequest.mergeMethod ?? 'squash'})`);
    return 'already-armed';
  }
  if (pr.state !== 'OPEN') {
    log(`PR #${pr.number}: state is ${pr.state}, skipping`);
    return 'not-open';
  }

  // GitHub recomputes mergeability after every base push and reports UNKNOWN
  // for a few seconds; arming during that window is rejected. Give it one
  // re-query (after a short beat) before deferring to the next sweep.
  if (pr.mergeable === 'UNKNOWN' || pr.mergeStateStatus === 'UNKNOWN') {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
    const refetched = ghJsonRetry('pr', 'view', String(pr.number), '--json', 'mergeable,mergeStateStatus');
    pr.mergeable = refetched.mergeable;
    pr.mergeStateStatus = refetched.mergeStateStatus;
  }

  if (pr.mergeable === false || pr.mergeStateStatus === 'DIRTY' || pr.mergeStateStatus === 'CONFLICTING') {
    // Dependabot rebases conflicted branches automatically; the next sweep retries.
    log(`PR #${pr.number}: conflicted with main (${pr.mergeStateStatus ?? 'unknown'}) — leaving for Dependabot rebase + next sweep`);
    return 'conflicted';
  }
  if (pr.mergeable === 'UNKNOWN' || pr.mergeStateStatus === 'UNKNOWN') {
    log(`PR #${pr.number}: mergeability still being computed — leaving for the next sweep`);
    return 'unknown-mergeability';
  }
  if (dryRun) {
    log(`PR #${pr.number}: DRY RUN — would arm auto-merge (squash)`);
    return 'dry-run';
  }
  try {
    ghRetry('pr', 'merge', String(pr.number), '--auto', '--squash');
    log(`PR #${pr.number}: auto-merge armed (squash)`);
    return 'armed';
  } catch (error) {
    // Final backstop for anything the pre-checks missed — surface gh's own
    // stderr (the real reason) instead of the bare "Command failed" line.
    const detail = String(error.stderr || error.message).split('\n').filter(Boolean).pop();
    log(`PR #${pr.number}: could not arm auto-merge (${detail}) — leaving for the next sweep`);
    if (/not accessible by integration/i.test(detail)) {
      // GitHub's platform policy: GITHUB_TOKEN can never modify Dependabot PR
      // merge state. Arming needs a PAT (set the DEPENDABOT_MERGE_TOKEN secret,
      // the workflow prefers it) or the scheduled local sweep with gh auth.
      log('GITHUB_TOKEN cannot arm Dependabot PRs (GitHub policy). Add the DEPENDABOT_MERGE_TOKEN secret — the workflow uses it automatically — or run the local sweep: node scripts/github/dependency-automerge-policy.mjs --sweep');
    }
    return 'arm-failed';
  }
}

function hasPolicyComment(pr, marker) {
  return (pr.comments ?? []).some((comment) => comment.body?.includes(marker));
}

function postRiskComment(pr, policy, decision, dryRun) {
  if (hasPolicyComment(pr, policy.commentMarker)) {
    log(`PR #${pr.number}: policy comment already present, not repeating`);
    return;
  }
  const lines = [
    policy.commentMarker,
    '**Dependency automerge policy: needs human review**',
    '',
    'This dependency-update PR stays in the manual lane because:',
    ...decision.blocked.map((reason) => `- ${reason}`),
    '',
    'Everything else about this PR already passed policy — merge when the review is done.',
  ];
  if (dryRun) {
    log(`PR #${pr.number}: DRY RUN — would post risk comment:\n${lines.join('\n')}`);
    return;
  }
  gh('pr', 'comment', String(pr.number), '--body', lines.join('\n'));
  log(`PR #${pr.number}: risk comment posted`);
}

async function processPr(prNumber, policy, dryRun) {
  const pr = ghJsonRetry(
    'pr',
    'view',
    String(prNumber),
    '--json',
    'number,title,author,state,files,baseRefOid,headRefOid,mergeable,mergeStateStatus,statusCheckRollup,autoMergeRequest,comments'
  );

  if (!DEPENDABOT_LOGINS.has(pr.author?.login)) {
    log(`PR #${prNumber}: author ${pr.author?.login ?? 'unknown'} is not dependabot, skipping`);
    return { lane: 'skipped', decision: 'not a Dependabot PR' };
  }

  const manifests = (pr.files ?? []).map((f) => f.path).filter((p) => p === 'package.json' || p.endsWith('/package.json'));

  let delta;
  if (manifests.length === 0) {
    delta = { changed: [], overridesChanged: false, toolingOnly: true };
  } else {
    delta = { changed: [], overridesChanged: false, toolingOnly: false };
    const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? 'MdSaifulIslamMSI/Aura').split('/');
    for (const manifestPath of manifests) {
      const base = fetchManifest(owner, repo, manifestPath, pr.baseRefOid);
      const head = fetchManifest(owner, repo, manifestPath, pr.headRefOid);
      const part = manifestDelta(base, head);
      delta.changed.push(...part.changed);
      delta.overridesChanged = delta.overridesChanged || part.overridesChanged;
    }
  }

  const decision = decide(policy, delta);
  log(
    `PR #${pr.number} (${pr.title}): lane=${decision.lane.toUpperCase()} ` +
      `deps=${delta.changed.length}${delta.toolingOnly ? ' (tooling-only: actions/docker bump)' : ''}` +
      `${delta.overridesChanged ? ' [OVERRIDES CHANGED]' : ''}`
  );

  if (decision.lane === 'safe') {
    const failing = failedChecks(pr);
    if (failing.length > 0) {
      const names = failing.map((c) => c.name ?? c.context ?? 'unknown').join(', ');
      log(`PR #${pr.number}: NOT arming auto-merge, ${failing.length} failing check(s): ${names}`);
      return { lane: 'held-failing-checks', decision: `held: failing ${names}` };
    }
    ensureLabel(policy.labels.safe, '0e8a16', 'Dependency policy: auto-merge when required checks pass', dryRun);
    if (!dryRun) gh('pr', 'edit', String(pr.number), '--add-label', policy.labels.safe);
    const armResult = armAutoMerge(pr, dryRun);
    const decisionText = {
      'armed': 'auto-merge armed (squash)',
      'already-armed': 'auto-merge already armed',
      'conflicted': 'conflicted — waiting for Dependabot rebase',
      'unknown-mergeability': 'mergeability computing — retry next sweep',
      'dry-run': 'would arm auto-merge (dry run)',
      'arm-failed': 'arm failed — retry next sweep',
      'not-open': 'not open',
    }[armResult] ?? armResult;
    return { lane: 'safe', decision: decisionText };
  }

  ensureLabel(policy.labels.risk, 'd93f0b', 'Dependency policy: blocked from automerge, needs review', dryRun);
  if (!dryRun) gh('pr', 'edit', String(pr.number), '--add-label', policy.labels.risk);
  postRiskComment(pr, policy, decision, dryRun);
  return { lane: 'risk', decision: `manual lane: ${decision.blocked.join('; ')}` };
}

function writeStepSummary(results, dryRun) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target || results.length === 0) return;
  const lines = [
    `## Dependency automerge policy${dryRun ? ' — dry run' : ''}`,
    '',
    '| PR | Lane | Decision |',
    '| --- | --- | --- |',
    ...results.map((r) => `| #${r.number ?? '?'} | ${r.lane} | ${r.decision ?? ''} |`),
    '',
  ];
  appendFileSync(target, lines.join('\n'));
}

function summarize(results, dryRun) {
  const counts = {};
  for (const { lane } of results) counts[lane] = (counts[lane] ?? 0) + 1;
  log(`Done${dryRun ? ' (dry run)' : ''}: ${JSON.stringify(counts)}`);
}

async function main() {
  const policy = loadPolicy();

  if (args.includes('--self-test')) {
    runSelfTest();
    return;
  }

  if (args.includes('--sweep')) {
    const open = ghJsonRetry('pr', 'list', '--state', 'open', '--author', DEPENDABOT_ACTOR, '--limit', '50', '--json', 'number');
    log(`Sweep: ${open.length} open Dependabot PR(s)`);
    const results = [];
    for (const { number } of open) {
      try {
        const outcome = await processPr(number, policy, DRY_RUN);
        results.push({ number, lane: outcome.lane, decision: outcome.decision });
      } catch (error) {
        log(`PR #${number}: ERROR ${error.message}`);
        results.push({ number, lane: 'error', decision: error.message.split('\n')[0] });
      }
    }
    writeStepSummary(results, DRY_RUN);
    summarize(results, DRY_RUN);
    return;
  }

  const prArg = args.includes('--pr') ? args[args.indexOf('--pr') + 1] : process.env.GH_PR_NUMBER;
  if (!prArg) {
    console.error('Usage: dependency-automerge-policy.mjs --pr <number> | --sweep [--dry-run] | --self-test');
    process.exit(2);
  }
  const result = await processPr(prArg, policy, DRY_RUN);
  writeStepSummary([{ number: prArg, ...result }], DRY_RUN);
  summarize([result], DRY_RUN);
}

function runSelfTest() {
  const assert = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
    if (!ok) process.exitCode = 1;
  };

  assert('patch bump', classifyRangeChange('^1.2.3', '^1.2.9'), 'patch');
  assert('minor bump', classifyRangeChange('~2.0.0', '~2.3.0'), 'minor');
  assert('major bump', classifyRangeChange('^10.2.0', '^12.1.3'), 'major');
  assert('exact pin bump', classifyRangeChange('9.9.4', '9.10.2'), 'minor');
  assert('unparseable is unknown', classifyRangeChange('file:vendor/x', '2.0.0'), 'unknown');

  const policy = loadPolicy();
  assert('blocklist exact hit', matchesBlocklist('stripe', policy.automerge.majorBlocklist), true);
  assert('blocklist wildcard hit', matchesBlocklist('@sentry/node', policy.automerge.majorBlocklist), true);
  assert('blocklist miss', matchesBlocklist('left-pad', policy.automerge.majorBlocklist), false);

  const base = { dependencies: { a: '^1.0.0', b: '^1.0.0' }, overrides: { x: '1.0.0' } };
  const headPatch = { dependencies: { a: '^1.0.1', b: '^1.0.0' }, overrides: { x: '1.0.0' } };
  const headOverride = { dependencies: { a: '^1.0.0', b: '^1.0.0' }, overrides: { x: '1.0.1' } };
  assert('delta patch', manifestDelta(base, headPatch).changed, [{ name: 'a', section: 'dependencies', from: '^1.0.0', to: '^1.0.1', kind: 'patch' }]);
  assert('delta override detect', manifestDelta(base, headOverride).overridesChanged, true);
}

main().catch((error) => {
  console.error('[dep-automerge] fatal:', error.message);
  process.exit(1);
});
