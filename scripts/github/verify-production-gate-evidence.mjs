#!/usr/bin/env node
/**
 * Same-SHA production gate evidence.
 *
 * The production command center re-runs the canonical gate workflows
 * (ci.yml, giant-release-gates.yml) on every dispatch. When the dispatch
 * targets a SHA whose identical gate workflows already concluded success on
 * pushes to main (or a prior same-SHA dispatch), re-running them is pure
 * wall-clock cost, so this script emits trust outputs that let the command
 * center skip the re-runs.
 *
 * Fail-open by design: any query error or ambiguity yields trusted=false and
 * the caller re-runs the gates exactly as before. Nothing here can turn a
 * failing gate into a trusted one.
 *
 * Outputs (GITHUB_OUTPUT): quality_trusted, release_safety_trusted.
 */
import fs from 'node:fs';

const TRUSTED_WORKFLOW_PATHS = {
  quality: '.github/workflows/ci.yml',
  releaseSafety: '.github/workflows/giant-release-gates.yml',
};
const TRUSTED_EVENTS = new Set(['push', 'workflow_call', 'workflow_dispatch']);
const MAX_PAGES = 3;

/**
 * Pure trust rule so the semantics are unit-testable.
 *
 * @param {{
 *   runs: Array<{path?: string, event?: string, head_branch?: string, status?: string, conclusion?: string}>,
 *   dispatchStagingAck: boolean,
 *   stagingPaused: boolean,
 * }} input
 * @returns {{qualityTrusted: boolean, releaseSafetyTrusted: boolean}}
 */
function computeGateTrust({ runs, dispatchStagingAck, stagingPaused }) {
  const green = (workflowPath) => Array.isArray(runs) && runs.some((run) => (
    run.path === workflowPath
    && TRUSTED_EVENTS.has(run.event)
    && run.head_branch === 'main'
    && run.status === 'completed'
    && run.conclusion === 'success'
  ));

  const qualityTrusted = green(TRUSTED_WORKFLOW_PATHS.quality);

  // production-on-push derives its canonical-release-safety-gates staging ack
  // from vars.STAGING_INFRA_PAUSED. Push evidence only covers a dispatch that
  // acknowledges staging-off (or one that demanded the live staging gates,
  // which the push run satisfied as the stricter case).
  const pushStagingAck = stagingPaused;
  const pushCoversDispatchStagingPosture = dispatchStagingAck === true || pushStagingAck === false;

  const releaseSafetyTrusted = green(TRUSTED_WORKFLOW_PATHS.releaseSafety)
    && pushCoversDispatchStagingPosture;

  return { qualityTrusted, releaseSafetyTrusted };
}

async function fetchRuns({ repo, sha, token }) {
  const runs = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } },
    );
    if (!response.ok) {
      throw new Error(`runs query failed: ${response.status} ${await response.text().catch(() => '')}`);
    }
    const payload = await response.json();
    for (const run of payload.workflow_runs || []) runs.push(run);
    if (!(payload.workflow_runs || []).length) break;
  }
  return runs;
}

function writeOutput(lines) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  }
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY || '';
  const sha = process.env.GATE_SHA || process.env.GITHUB_SHA || '';
  const token = process.env.GITHUB_TOKEN || '';
  const dispatchStagingAck = (process.env.DISPATCH_STAGING_ACK || '') === 'true';
  const stagingPaused = (process.env.STAGING_INFRA_PAUSED || '') === 'true';

  let qualityTrusted = false;
  let releaseSafetyTrusted = false;
  let evidence = 'query-failed';
  try {
    if (!repo || !sha || !token) throw new Error('missing GITHUB_REPOSITORY, GATE_SHA, or GITHUB_TOKEN');
    const runs = await fetchRuns({ repo, sha, token });
    ({ qualityTrusted, releaseSafetyTrusted } = computeGateTrust({ runs, dispatchStagingAck, stagingPaused }));
    evidence = `${runs.length} run(s) for ${sha}`;
  } catch (error) {
    // Fail open: any doubt re-runs the gates.
    console.log(`::warning::gate evidence unavailable (${error.message}); canonical gates will re-run.`);
  }

  console.log(`gate evidence for ${sha}: ${evidence}`);
  console.log(`quality_trusted=${qualityTrusted}`);
  console.log(`release_safety_trusted=${releaseSafetyTrusted}`);
  writeOutput([
    `quality_trusted=${qualityTrusted}`,
    `release_safety_trusted=${releaseSafetyTrusted}`,
  ]);
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('verify-production-gate-evidence.mjs');
if (invokedDirectly) {
  main().catch((error) => {
    console.log(`::warning::gate evidence crashed (${error.message}); canonical gates will re-run.`);
    writeOutput(['quality_trusted=false', 'release_safety_trusted=false']);
  });
}

export { computeGateTrust };
