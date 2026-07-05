#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  gitBranch,
  gitSha,
  normalize,
  readEvidence,
  repoRoot,
  sha256File,
  writeEvidence,
  writeJsonAtomic,
} from '../lib/release-guard-utils.mjs';

const args = process.argv.slice(2);
const getArg = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
};

const artifactPath = normalize(getArg('--artifact') || process.env.RELEASE_ARTIFACT_PATH);
if (!artifactPath) {
  console.error('FAIL: --artifact or RELEASE_ARTIFACT_PATH is required.');
  process.exit(1);
}

const absoluteArtifact = path.resolve(repoRoot, artifactPath);
if (!fs.existsSync(absoluteArtifact)) {
  console.error(`FAIL: release artifact does not exist: ${artifactPath}`);
  process.exit(1);
}

const manifest = {
  gitSha: gitSha(),
  branch: gitBranch(),
  buildTime: new Date().toISOString(),
  artifactName: normalize(getArg('--artifact-name')) || path.basename(artifactPath),
  artifactPath,
  sha256: sha256File(absoluteArtifact),
  stagingSmokeStatus: readEvidence('staging-smoke')?.status || 'missing',
  envContractStatus: readEvidence('env-contract')?.status || 'missing',
  costGuardStatus: readEvidence('cost-guard')?.status || 'missing',
  observabilityGuardStatus: readEvidence('observability-guard')?.status || 'missing',
  rollbackTarget: normalize(process.env.ROLLBACK_TARGET_SHA || process.env.ROLLBACK_ARTIFACT_URI || ''),
  operator: normalize(process.env.GITHUB_ACTOR || process.env.USERNAME || process.env.USER || 'unknown'),
  productionAllowed: false,
};

const missingStatuses = [
  ['stagingSmokeStatus', manifest.stagingSmokeStatus],
  ['envContractStatus', manifest.envContractStatus],
  ['costGuardStatus', manifest.costGuardStatus],
].filter(([, value]) => value !== 'pass');
if (missingStatuses.length === 0 && manifest.rollbackTarget) {
  manifest.productionAllowed = true;
}

const outDir = path.join(repoRoot, 'artifacts', 'release-manifests');
const outFile = path.join(outDir, `${manifest.gitSha}.json`);
writeJsonAtomic(outFile, manifest);
writeJsonAtomic(path.join(outDir, 'latest.json'), manifest);
writeEvidence('release-manifest', { ...manifest, status: manifest.productionAllowed ? 'pass' : 'blocked' });
console.log(`PASS: wrote release manifest ${path.relative(repoRoot, outFile)}`);
console.log(`artifact sha256: ${manifest.sha256}`);
