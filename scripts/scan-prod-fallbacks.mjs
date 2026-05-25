#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  KNOWN_PRODUCTION_HOSTS,
  PRODUCTION_SSM_PREFIX,
  REPO_ROOT,
  STAGING_SSM_PREFIX,
} from './env-contract-lib.mjs';

const SCAN_ROOTS = [
  '.github/workflows',
  'app',
  'config',
  'docs',
  'infra',
  'scripts',
  'server/scripts',
  'vercel.json',
  'netlify.toml',
  'package.json',
];

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.vercel',
  '.netlify',
  'security-reports',
  '.run-logs',
]);

const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.conf',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ps1',
  '.sh',
  '.toml',
  '.ts',
  '.tsx',
  '.yml',
  '.yaml',
  '',
]);

const ALLOWED_PRODUCTION_FILES = new Set([
  'scripts/scan-prod-fallbacks.mjs',
  'scripts/env-contract-lib.mjs',
  'scripts/smoke-production-login.mjs',
  'scripts/smoke-origin-protection.mjs',
  'server/scripts/audit_production_hardening_contract.js',
  'server/scripts/audit_login_production_env_contract.js',
  'server/scripts/verify_cross_domain_prod.js',
  'server/scripts/assert_staging_smoke_safety.js',
  'server/tests/stagingSmokeSafety.test.js',
  'server/tests/envContractScripts.test.js',
  'docs/environment-contract.md',
  'docs/staging-bootstrap.md',
  'docs/staging-readiness-inventory.md',
  'docs/aws-backend-deployment.md',
  'docs/aws-frontend-deployment.md',
  'docs/login-staging-production-activation.md',
  'docs/production-cicd-install.md',
  '.github/workflows/production-cicd.yml',
  '.github/workflows/deploy-backend-aws.yml',
  '.github/workflows/deploy-frontend-aws.yml',
  '.github/workflows/deploy-netlify.yml',
  '.github/workflows/deploy-gateway-vercel.yml',
  '.github/workflows/rollback-backend-aws.yml',
  '.github/workflows/rollback-frontend-aws.yml',
  '.github/workflows/rollback-netlify.yml',
  '.github/workflows/rollback-gateway-vercel.yml',
]);

const toRepoPath = (absolutePath) => path.relative(REPO_ROOT, absolutePath).replace(/\\/g, '/');

const isGeneratedRepoPath = (repoPath = '') => repoPath.startsWith('app/android/app/src/main/assets/public/')
  || repoPath.startsWith('app/ios/App/App/public/')
  || repoPath.startsWith('app/dist/')
  || repoPath.startsWith('desktop-release/')
  || repoPath.startsWith('generated/')
  || repoPath.startsWith('output/');

const walk = (targetPath, files = []) => {
  if (!fs.existsSync(targetPath)) return files;
  const stats = fs.statSync(targetPath);
  if (stats.isFile()) {
    if (TEXT_EXTENSIONS.has(path.extname(targetPath).toLowerCase())) files.push(targetPath);
    return files;
  }
  if (!stats.isDirectory()) return files;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    walk(path.join(targetPath, entry.name), files);
  }
  return files;
};

export const scanTextForProdFallbacks = ({ text = '', file = '' } = {}) => {
  const findings = [];
  const normalizedFile = file.replace(/\\/g, '/');
  const allowedProductionContext = ALLOWED_PRODUCTION_FILES.has(normalizedFile);
  if (allowedProductionContext) return findings;
  const lines = String(text || '').split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const lower = line.toLowerCase();
    const hasStaging = lower.includes('staging') || lower.includes('stage') || lower.includes('smoke_target_env');
    const hasPreview = /\bpreview\b/.test(lower);
    const hasFallbackOperator = /\|\||\?\?/.test(line);
    const hasProductionToken = /\b(prod|production|live)\b/i.test(line)
      || /PROD[_A-Z0-9]*|PRODUCTION[_A-Z0-9]*/.test(line)
      || line.includes(PRODUCTION_SSM_PREFIX)
      || KNOWN_PRODUCTION_HOSTS.some((host) => line.includes(host));

    if (hasStaging && hasFallbackOperator && hasProductionToken) {
      findings.push({
        file: normalizedFile,
        line: lineNumber,
        reason: 'staging value falls back to production-like value',
        text: line.trim(),
      });
    }

    if (hasStaging && line.includes(PRODUCTION_SSM_PREFIX) && !line.includes(STAGING_SSM_PREFIX)) {
      findings.push({
        file: normalizedFile,
        line: lineNumber,
        reason: `${PRODUCTION_SSM_PREFIX} appears in a staging context`,
        text: line.trim(),
      });
    }

    if (hasPreview && /backend staging|full-stack staging|full stack staging/i.test(line) && !/not|unless|isolated/i.test(line)) {
      findings.push({
        file: normalizedFile,
        line: lineNumber,
        reason: 'preview is described as backend/full-stack staging without isolation language',
        text: line.trim(),
      });
    }

    if (!allowedProductionContext
      && /(staging|smoke|preview)/i.test(normalizedFile)
      && KNOWN_PRODUCTION_HOSTS.some((host) => line.includes(host))) {
      findings.push({
        file: normalizedFile,
        line: lineNumber,
        reason: 'production host appears in staging/smoke/preview file',
        text: line.trim(),
      });
    }
  });

  return findings;
};

export const scanRepoForProdFallbacks = ({ root = REPO_ROOT } = {}) => {
  const files = SCAN_ROOTS.flatMap((entry) => walk(path.join(root, entry)));
  const findings = [];
  for (const absolutePath of files) {
    const repoPath = toRepoPath(absolutePath);
    if (isGeneratedRepoPath(repoPath)) continue;
    if (repoPath === 'package-lock.json') continue;
    const text = fs.readFileSync(absolutePath, 'utf8');
    findings.push(...scanTextForProdFallbacks({ text, file: repoPath }));
  }
  return findings;
};

const isCli = Boolean(process.argv[1])
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const findings = scanRepoForProdFallbacks();
  if (findings.length === 0) {
    console.log('prod-fallback-scan: passed');
  } else {
    console.error(`prod-fallback-scan: failed (${findings.length} finding(s))`);
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line} ${finding.reason}: ${finding.text}`);
    }
    process.exitCode = 1;
  }
}
