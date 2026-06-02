import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const workflowDir = path.join(repoRoot, '.github', 'workflows');
const mutableRefs = new Set(['main', 'master', 'latest', 'stable', 'edge', 'nightly']);
const mutableImageTags = new Set(['latest']);
const pinnedCommitPattern = /^[0-9a-f]{40}$/i;
const strictPinnedWorkflowFiles = new Set([
  'staging-ops-watch.yml',
]);

const isGitHubMaintainedAction = (action = '') => (
  action.startsWith('actions/')
  || action.startsWith('github/codeql-action/')
);

const failures = [];
let checkedActionRefs = 0;
let checkedImageRefs = 0;
let checkedStrictWorkflowActionRefs = 0;

if (existsSync(workflowDir)) {
  for (const fileName of readdirSync(workflowDir)) {
    if (!/\.ya?ml$/i.test(fileName)) continue;
    const filePath = path.join(workflowDir, fileName);
    const content = readFileSync(filePath, 'utf8');
    const requireImmutableActionRefs = strictPinnedWorkflowFiles.has(fileName);
    const usesMatches = content.matchAll(/uses:\s*([^\s#]+)@([^\s#]+)/g);
    for (const match of usesMatches) {
      checkedActionRefs += 1;
      const action = match[1].replace(/^['"]|['"]$/g, '');
      const ref = match[2].replace(/^['"]|['"]$/g, '');
      if (mutableRefs.has(ref) || ref.includes('${{')) {
        failures.push(`${path.relative(repoRoot, filePath)} uses mutable action ref ${action}@${ref}`);
      }
      if (requireImmutableActionRefs) {
        checkedStrictWorkflowActionRefs += 1;
        if (!pinnedCommitPattern.test(ref)) {
          failures.push(`${path.relative(repoRoot, filePath)} uses security-sensitive action ref ${action}@${ref}; pin it to a full commit SHA`);
        }
      }
      if (!isGitHubMaintainedAction(action) && !pinnedCommitPattern.test(ref)) {
        failures.push(`${path.relative(repoRoot, filePath)} uses third-party action ref ${action}@${ref}; pin it to a full commit SHA`);
      }
    }
  }
}

const dockerToolPath = path.join(repoRoot, 'scripts', 'security', 'run-docker-tool.mjs');
if (existsSync(dockerToolPath)) {
  const content = readFileSync(dockerToolPath, 'utf8');
  const imageMatches = content.matchAll(/['"]([a-z0-9./_-]+(?::[A-Za-z0-9._-]+))['"]/gi);
  for (const match of imageMatches) {
    const image = match[1];
    if (!image.includes('/')) continue;
    checkedImageRefs += 1;
    const tag = image.split(':').at(-1);
    if (mutableImageTags.has(tag)) {
      failures.push(`scripts/security/run-docker-tool.mjs uses mutable Docker image tag ${image}`);
    }
  }
}

if (failures.length > 0) {
  console.error('[security:supply-chain-pins] Mutable supply-chain references found:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`[security:supply-chain-pins] Checked ${checkedActionRefs} workflow action refs, ${checkedStrictWorkflowActionRefs} strict workflow action refs, and ${checkedImageRefs} Docker image refs.`);
