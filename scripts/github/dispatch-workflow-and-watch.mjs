#!/usr/bin/env node

const DEFAULT_TIMEOUT_MINUTES = 45;
const DEFAULT_POLL_SECONDS = 15;

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith('--')) {
    continue;
  }

  const key = arg.slice(2);
  const next = process.argv[index + 1];
  if (!next || next.startsWith('--')) {
    args.set(key, 'true');
  } else {
    args.set(key, next);
    index += 1;
  }
}

const workflow = args.get('workflow');
const label = args.get('label') || workflow;
const ref = args.get('ref') || process.env.GITHUB_REF_NAME || 'main';
const expectedSha = args.get('sha') || process.env.GITHUB_SHA || '';
const timeoutMinutes = Number(args.get('timeout-minutes') || DEFAULT_TIMEOUT_MINUTES);
const pollSeconds = Number(args.get('poll-seconds') || DEFAULT_POLL_SECONDS);
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;

if (args.has('help')) {
  console.log([
    'Usage:',
    '  node scripts/github/dispatch-workflow-and-watch.mjs --workflow <file.yml> --inputs <json>',
    '',
    'Required in GitHub Actions:',
    '  GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_REF_NAME, GITHUB_SHA',
  ].join('\n'));
  process.exit(0);
}

if (!workflow) {
  throw new Error('Missing --workflow');
}

if (!token) {
  throw new Error('Missing GITHUB_TOKEN');
}

if (!repository || !repository.includes('/')) {
  throw new Error('Missing GITHUB_REPOSITORY');
}

const inputs = args.has('inputs') ? JSON.parse(args.get('inputs')) : {};
const [owner, repo] = repository.split('/');
const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
const dispatchStartedAt = new Date(Date.now() - 10_000).toISOString();
const deadline = Date.now() + timeoutMinutes * 60_000;

async function github(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = body?.message || response.statusText;
    throw new Error(`GitHub API ${response.status} for ${path}: ${message}`);
  }

  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findDispatchedRun() {
  const query = new URLSearchParams({
    event: 'workflow_dispatch',
    branch: ref,
    per_page: '20',
  });
  const body = await github(`/actions/workflows/${encodeURIComponent(workflow)}/runs?${query}`);
  const runs = body?.workflow_runs || [];
  const recentRuns = runs.filter((run) => new Date(run.created_at) >= new Date(dispatchStartedAt));
  const matchingRun = recentRuns.find((run) => !expectedSha || run.head_sha === expectedSha);
  if (matchingRun) {
    return matchingRun;
  }

  const mismatchedRun = expectedSha
    ? recentRuns.find((run) => run.head_sha && run.head_sha !== expectedSha)
    : null;
  if (mismatchedRun) {
    throw new Error([
      `${label} run appeared at ${mismatchedRun.head_sha}, expected ${expectedSha}.`,
      `The dispatch ref "${ref}" likely moved before GitHub created the child run.`,
      `Failing fast so a stale production parent does not block newer main pushes: ${mismatchedRun.html_url}`,
    ].join(' '));
  }

  return null;
}

async function summarizeJobs(runId) {
  const body = await github(`/actions/runs/${runId}/jobs?per_page=100`);
  const jobs = body?.jobs || [];
  return jobs.map((job) => `${job.name}:${job.status}${job.conclusion ? `/${job.conclusion}` : ''}`).join(', ');
}

console.log(`Dispatching ${label} (${workflow}) on ${ref}${expectedSha ? ` @ ${expectedSha}` : ''}`);

await github(`/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
  method: 'POST',
  body: JSON.stringify({ ref, inputs }),
});

let run = null;
while (Date.now() < deadline) {
  run = await findDispatchedRun();
  if (run) {
    break;
  }
  console.log(`Waiting for ${label} run to appear...`);
  await sleep(pollSeconds * 1000);
}

if (!run) {
  throw new Error(`Timed out waiting for ${label} run to appear`);
}

console.log(`${label} run: ${run.html_url}`);

while (Date.now() < deadline) {
  const current = await github(`/actions/runs/${run.id}`);
  const jobs = await summarizeJobs(run.id);
  console.log(`${label}: ${current.status}${current.conclusion ? `/${current.conclusion}` : ''}${jobs ? ` | ${jobs}` : ''}`);

  if (current.status === 'completed') {
    if (current.conclusion === 'success') {
      console.log(`${label} completed successfully.`);
      process.exit(0);
    }
    throw new Error(`${label} completed with conclusion ${current.conclusion}: ${current.html_url}`);
  }

  await sleep(pollSeconds * 1000);
}

throw new Error(`Timed out waiting for ${label} to complete: ${run.html_url}`);
