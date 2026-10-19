import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const workflowDir = path.join(repoRoot, '.github', 'workflows');
const mutableRefs = new Set(['main', 'master', 'latest', 'stable', 'edge', 'nightly']);
const mutableImageTags = new Set(['latest']);
const pinnedCommitPattern = /^[0-9a-f]{40}$/i;
const pinnedDigestPattern = /@sha256:[0-9a-f]{64}$/i;
const strictPinnedWorkflowFiles = new Set([
  'staging-ops-watch.yml',
]);

// Directories that never hold repo-owned compose files or Dockerfiles and are
// expensive to walk.
const skippedDirectories = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'reports',
  'security-reports',
  'artifacts',
  'output',
  'generated',
  '.codex',
  '.nucleicache',
  '.trivycache',
  '.cache_ggshield',
  'desktop-release',
  '.staging',
  '.vercel',
  '.netlify',
  '.playwright-cli',
]);

const isGitHubMaintainedAction = (action = '') => (
  action.startsWith('actions/')
  || action.startsWith('github/codeql-action/')
);

const failures = [];
let checkedActionRefs = 0;
let checkedImageRefs = 0;
let checkedStrictWorkflowActionRefs = 0;
let checkedContainerImageRefs = 0;

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

// Container images referenced by compose files and Dockerfiles.
//
// A tag is not a pin: the tag owner can re-push it, so "caddy:2-alpine" and
// "ollama/ollama:latest" are both mutable references and a build that pulls
// them is a supply-chain hole. A registry image must therefore be pinned to a
// digest (image@sha256:...). The repository's own Dockerfiles already are.
//
// Two cases are deliberately NOT failures:
//   - variable-interpolated references (image: ${AURA_BACKEND_IMAGE:?...}):
//     the value is resolved by the operator at deploy time, not by this repo.
//   - images built from source in this repository (a service with a `build:`
//     section, or the repository's `:local` tag convention): there is no
//     registry digest to pin to.

const isComposeFile = (fileName) => /^docker-compose[^/]*\.ya?ml$/i.test(fileName);
const isDockerfile = (fileName) => (
  /^dockerfile$/i.test(fileName)
  || /^dockerfile\..+$/i.test(fileName)
  || /\.dockerfile$/i.test(fileName)
);

const collectContainerFiles = (rootDir) => {
  const found = [];
  const stack = [{ dir: rootDir, depth: 0 }];

  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth >= 8 || skippedDirectories.has(entry.name)) continue;
        stack.push({ dir: fullPath, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      if (isComposeFile(entry.name) || isDockerfile(entry.name)) found.push(fullPath);
    }
  }

  return found.sort();
};

// Minimal compose reader: services live under the top-level `services:` key,
// service names are indented by two spaces and service keys by four. Only the
// `image:` values and the presence of a `build:` section are needed, so the
// file is read line by line instead of parsed with a YAML library (this gate
// runs without `npm install` in CI).
const parseComposeImages = (content) => {
  const images = [];
  let inServices = false;
  let currentService = null;

  const flushService = () => {
    if (!currentService) return;
    for (const line of currentService.lines) {
      const match = line.match(/^image:\s*(\S.*)$/);
      if (!match) continue;
      const image = match[1].trim().replace(/^['"]|['"]$/g, '');
      if (!image || image.endsWith(':')) continue;
      images.push({ image, locallyBuilt: currentService.hasBuild });
    }
    currentService = null;
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, '  ');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;

    if (indent === 0) {
      flushService();
      inServices = trimmed === 'services:' || trimmed.startsWith('services:');
      continue;
    }
    if (!inServices) continue;

    if (indent === 2) {
      flushService();
      const serviceMatch = trimmed.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
      if (serviceMatch) currentService = { name: serviceMatch[1], lines: [], hasBuild: false };
      continue;
    }
    if (!currentService) continue;
    if (/^build:/.test(trimmed)) {
      currentService.hasBuild = true;
      continue;
    }
    if (indent === 4) currentService.lines.push(trimmed);
  }
  flushService();

  return images;
};

const parseDockerfileImages = (content) => {
  const images = [];
  for (const match of content.matchAll(/^\s*FROM\s+(.+)$/gim)) {
    const parts = match[1].trim().split(/\s+/);
    // Drop the stage alias ("AS deps") and any --platform=... prefix.
    const reference = parts.find((part) => !/^as$/i.test(part) && !part.startsWith('--') && part.toLowerCase() !== 'as')
      || '';
    if (!reference) continue;
    images.push({ image: reference, locallyBuilt: false });
  }
  return images;
};

const isLocallyBuiltImage = (image) => {
  const tag = image.split('@')[0].split(':').at(-1) || '';
  return tag === 'local';
};

for (const filePath of collectContainerFiles(repoRoot)) {
  const relativePath = path.relative(repoRoot, filePath);
  const content = readFileSync(filePath, 'utf8');
  const references = isDockerfile(path.basename(filePath))
    ? parseDockerfileImages(content)
    : parseComposeImages(content);

  for (const { image, locallyBuilt } of references) {
    // Interpolated values are resolved outside this repository.
    if (image.includes('${')) continue;
    // Images built from source in this repository have no registry digest.
    if (locallyBuilt || isLocallyBuiltImage(image)) continue;

    checkedContainerImageRefs += 1;
    if (!pinnedDigestPattern.test(image)) {
      failures.push(`${relativePath} uses Docker image ${image} without a digest pin`);
    }
  }
}

if (failures.length > 0) {
  console.error('[security:supply-chain-pins] Mutable supply-chain references found:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`[security:supply-chain-pins] Checked ${checkedActionRefs} workflow action refs, ${checkedStrictWorkflowActionRefs} strict workflow action refs, ${checkedImageRefs} Docker image refs, and ${checkedContainerImageRefs} container image refs.`);
