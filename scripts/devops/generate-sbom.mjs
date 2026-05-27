#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outputDir = path.join(repoRoot, 'security-reports');
fs.mkdirSync(outputDir, { recursive: true });

const workspaces = [
  { name: 'root', cwd: repoRoot },
  { name: 'app', cwd: path.join(repoRoot, 'app') },
  { name: 'server', cwd: path.join(repoRoot, 'server') },
];

for (const workspace of workspaces) {
  const lockfilePath = path.join(workspace.cwd, 'package-lock.json');
  if (!fs.existsSync(lockfilePath)) {
    console.log(`Skipping ${workspace.name}: package-lock.json not found`);
    continue;
  }

  const result = runNpmSbom(workspace.cwd);

  let sbom = result.stdout;

  if (result.error || result.status !== 0) {
    const reason = result.error?.message || result.stderr || result.stdout || 'unknown npm sbom error';
    console.warn(`npm sbom failed for ${workspace.name}; using package-lock fallback.`);
    console.warn(String(reason).trim());
    sbom = JSON.stringify(buildCycloneDxFromPackageLock(lockfilePath, workspace), null, 2);
  }

  const outputPath = path.join(outputDir, `sbom-${workspace.name}.json`);
  fs.writeFileSync(outputPath, sbom);
  console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
}

function runNpmSbom(cwd) {
  const args = ['sbom', '--sbom-format=cyclonedx', '--package-lock-only'];
  if (process.platform === 'win32') {
    return spawnSync('cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  return spawnSync('npm', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function buildCycloneDxFromPackageLock(lockfilePath, workspace) {
  const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
  const rootPackage = lockfile.packages?.[''] ?? {};
  const components = [];
  const seen = new Set();

  for (const [packagePath, packageMeta] of Object.entries(lockfile.packages ?? {})) {
    if (!packagePath || !packageMeta?.version) {
      continue;
    }

    const name = packageMeta.name || inferPackageName(packagePath);
    if (!name) {
      continue;
    }

    const key = `${name}@${packageMeta.version}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    components.push({
      type: 'library',
      'bom-ref': `pkg:npm/${encodePurlName(name)}@${packageMeta.version}`,
      name,
      version: packageMeta.version,
      purl: `pkg:npm/${encodePurlName(name)}@${packageMeta.version}`,
    });
  }

  components.sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));

  const rootName = rootPackage.name || path.basename(workspace.cwd);
  const rootVersion = rootPackage.version || '0.0.0';
  const serialHash = crypto
    .createHash('sha256')
    .update(`${workspace.name}:${rootName}:${rootVersion}`)
    .digest('hex');

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${[
      serialHash.slice(0, 8),
      serialHash.slice(8, 12),
      serialHash.slice(12, 16),
      serialHash.slice(16, 20),
      serialHash.slice(20, 32),
    ].join('-')}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [
        {
          vendor: 'Codex',
          name: 'package-lock-cyclonedx-fallback',
          version: '1.0.0',
        },
      ],
      component: {
        type: 'application',
        name: rootName,
        version: rootVersion,
      },
    },
    components,
  };
}

function inferPackageName(packagePath) {
  const segments = packagePath.split('/').filter(Boolean);
  const nodeModulesIndex = segments.lastIndexOf('node_modules');
  if (nodeModulesIndex < 0 || !segments[nodeModulesIndex + 1]) {
    return null;
  }

  const first = segments[nodeModulesIndex + 1];
  if (first.startsWith('@') && segments[nodeModulesIndex + 2]) {
    return `${first}/${segments[nodeModulesIndex + 2]}`;
  }

  return first;
}

function encodePurlName(name) {
  return name
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}
