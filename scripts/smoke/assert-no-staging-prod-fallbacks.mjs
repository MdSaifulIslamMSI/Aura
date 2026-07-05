#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  KNOWN_PRODUCTION_HOSTS,
  PRODUCTION_SSM_PREFIX,
  REPO_ROOT,
} from '../env-contract-lib.mjs';

const SCAN_ROOTS = [
  '.github/workflows',
  'app',
  'config',
  'docs',
  'scripts',
  'server',
  'vercel.json',
];

const SKIP_DIRS = new Set([
  '.git',
  '.staging',
  '.vercel',
  '.netlify',
  '.next',
  'node_modules',
  'build',
  'dist',
  'coverage',
  'security-reports',
  '.run-logs',
]);

const TEXT_EXTENSIONS = new Set(['', '.cjs', '.conf', '.js', '.json', '.md', '.mjs', '.sh', '.ts', '.tsx', '.yml', '.yaml']);

const ALLOWED_EXAMPLE_FILES = [
  /^docs\/environment-contract\.md$/,
  /^docs\/staging-/,
  /^docs\/aws-free-giant-release-inventory\.md$/,
  /^docs\/release\/main-review-checklist\.md$/,
  /^config\/aws-free-guard\.json$/,
  /^config\/environments\/staging\.example\./,
  /^scripts\/smoke\/assert-environment-contract\.mjs$/,
  /^scripts\/smoke\/assert-no-staging-prod-fallbacks\.mjs$/,
  /^scripts\/smoke\/assert-frontend-staging-target\.mjs$/,
  /^scripts\/smoke\/assert-staging-contract\.mjs$/,
  /^scripts\/smoke\/staging-route-smoke\.mjs$/,
  /^scripts\/smoke-production-login\.mjs$/,
  /^scripts\/staging\//,
  /^scripts\/staging\/vercel-staging-autopilot\.mjs$/,
  /^\.github\/workflows\/staging-aws-deploy\.yml$/,
  /^\.github\/workflows\/staging-frontend-smoke\.yml$/,
  /^\.github\/workflows\/staging-ops-watch\.yml$/,
  /^\.github\/workflows\/staging-smoke\.yml$/,
  /^scripts\/scan-prod-fallbacks\.mjs$/,
  /^scripts\/env-contract-lib\.mjs$/,
  /^server\/scripts\/assert_staging_smoke_safety\.js$/,
  /^server\/tests\//,
];

const toRepoPath = (absolutePath) => path.relative(REPO_ROOT, absolutePath).replace(/\\/g, '/');

const isAllowedExample = (repoPath) => ALLOWED_EXAMPLE_FILES.some((pattern) => pattern.test(repoPath));

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

export const scanNoStagingProdFallbacks = ({ root = REPO_ROOT } = {}) => {
  const findings = [];
  const files = SCAN_ROOTS.flatMap((entry) => walk(path.join(root, entry)));
  for (const absolutePath of files) {
    const repoPath = toRepoPath(absolutePath);
    if (isGeneratedRepoPath(repoPath)) continue;
    if (isAllowedExample(repoPath)) continue;
    const lowerRepoPath = repoPath.toLowerCase();
    const fileLooksStaging = /staging|stage|preview/.test(lowerRepoPath)
      || (/smoke/.test(lowerRepoPath) && !/production/.test(lowerRepoPath));
    const text = fs.readFileSync(absolutePath, 'utf8');
    const lines = text.split(/\r?\n/);

    lines.forEach((line, index) => {
      const lower = line.toLowerCase();
      const lineLooksStaging = /\bstaging\b|\bstage\b|smoke_target_env|staging_frontend|staging_api|staging_url/.test(lower);
      const inStagingContext = fileLooksStaging || lineLooksStaging;
      if (!inStagingContext) return;
      const comparisonOnlyProductionEnv = /\bPROD_(?:BASE_URL|API_BASE_URL|SSM_PREFIX)\b/.test(line)
        && !/STAGING_[A-Z0-9_]*\s*(?:\|\||\?\?)/.test(line);

      if (line.includes(PRODUCTION_SSM_PREFIX)) {
        findings.push({ repoPath, line: index + 1, reason: 'production SSM prefix in staging context', text: line.trim() });
      }
      if (KNOWN_PRODUCTION_HOSTS.some((host) => lower.includes(host))) {
        findings.push({ repoPath, line: index + 1, reason: 'production host in staging context', text: line.trim() });
      }
      if (/STAGING_[A-Z0-9_]*\s*(?:\|\||\?\?)\s*(?:process\.env\.)?PROD[A-Z0-9_]*/.test(line)) {
        findings.push({ repoPath, line: index + 1, reason: 'staging value falls back to production env', text: line.trim() });
      }
      if (!comparisonOnlyProductionEnv
        && /staging/i.test(line)
        && /(prod|production).*(database|redis|mongo|bucket|upload|cloudfront|api)/i.test(line)
        && !/must not|never|fail|blocked|forbidden|example|comparison/i.test(line)) {
        findings.push({ repoPath, line: index + 1, reason: 'staging text appears to reference production infrastructure', text: line.trim() });
      }
    });
  }

  return findings;
};

const isCli = Boolean(process.argv[1])
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  const findings = scanNoStagingProdFallbacks();
  if (findings.length > 0) {
    console.error(`staging-prod-fallback-scan: failed (${findings.length} finding(s))`);
    for (const finding of findings) {
      console.error(`${finding.repoPath}:${finding.line} ${finding.reason}: ${finding.text}`);
    }
    process.exit(1);
  }

  console.log('staging-prod-fallback-scan: passed');
}
