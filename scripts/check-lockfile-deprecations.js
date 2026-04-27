#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const lockfiles = [
  'package-lock.json',
  path.join('app', 'package-lock.json'),
  path.join('server', 'package-lock.json'),
];

const findings = [];
const missing = [];

for (const lockfile of lockfiles) {
  const absolutePath = path.join(rootDir, lockfile);

  if (!fs.existsSync(absolutePath)) {
    missing.push(lockfile);
    continue;
  }

  const lock = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  const packages = lock.packages;

  if (!packages || typeof packages !== 'object') {
    throw new Error(`${lockfile} is not a package-lock v2/v3 file with a packages map.`);
  }

  for (const [packagePath, metadata] of Object.entries(packages)) {
    if (!metadata || !metadata.deprecated) continue;

    findings.push({
      lockfile,
      packagePath: packagePath || '(project root)',
      version: metadata.version || '(unknown)',
      message: metadata.deprecated,
    });
  }
}

if (missing.length > 0) {
  console.error('[security] Missing expected npm lockfiles:');
  for (const lockfile of missing) {
    console.error(`- ${lockfile}`);
  }
  process.exit(1);
}

if (findings.length > 0) {
  console.error('[security] Deprecated packages are present in npm lockfiles:');
  for (const finding of findings) {
    console.error(`- ${finding.lockfile} :: ${finding.packagePath}@${finding.version}`);
    console.error(`  ${finding.message}`);
  }
  process.exit(1);
}

console.log(`[security] Deprecated package gate passed for ${lockfiles.length} npm lockfiles.`);
