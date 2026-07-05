import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  check,
  defaultRepoRoot,
  markdownTable,
  parseReadinessArgs,
  renderChecksMarkdown,
  shouldFail,
  summarizeChecks,
  writeReadinessReports,
} from '../security/pqc-readiness-utils.mjs';

const require = createRequire(import.meta.url);

export const parseTrafficAuditArgs = (argv, defaults = {}) => parseReadinessArgs(argv, {
  reportDir: path.join(defaultRepoRoot, 'artifacts', 'traffic'),
  ...defaults,
});

export const loadTrafficRegistry = (root = defaultRepoRoot) => {
  const registryPath = path.join(root, 'server', 'config', 'trafficPolicyRegistry.js');
  delete require.cache[registryPath];
  return require(registryPath);
};

export const buildTrafficAuditReport = ({ title, checks, options, extra = {} }) => {
  const summary = summarizeChecks(checks);
  return {
    title,
    generatedAt: new Date().toISOString(),
    status: shouldFail(checks, options) ? 'fail' : 'pass',
    strict: Boolean(options.strict),
    summary,
    checks,
    ...extra,
  };
};

export const renderPolicySummaryTable = (policies) => markdownTable(
  ['Component', 'Policy', 'Profile', 'Class', 'IP Limit', 'User Limit', 'Body', 'Timeout', 'Fail Mode'],
  policies.map((policy) => [
    policy.componentName,
    policy.id,
    policy.profileLabel,
    policy.routeClass,
    `${policy.perIpLimit}/${policy.sustainedWindow.seconds}s`,
    `${policy.perUserLimit || 0}/${policy.sustainedWindow.seconds}s`,
    String(policy.bodySizeBytes),
    `${policy.timeoutMs}ms`,
    policy.failMode,
  ]),
);

export const writeTrafficAuditOutputs = ({
  report,
  markdown,
  options,
  baseName,
  docsRelativePath = '',
}) => {
  const written = writeReadinessReports({
    report,
    markdown,
    reportDir: options.reportDir,
    baseName,
    options,
  });

  if (docsRelativePath) {
    const docsPath = path.join(options.root, docsRelativePath);
    mkdirSync(path.dirname(docsPath), { recursive: true });
    writeFileSync(docsPath, markdown);
    written.push(docsPath);
  }

  return written;
};

export const renderTrafficAuditMarkdown = (report, sections = []) => renderChecksMarkdown(report, sections);

export const readRepoText = (root, relativeFile) => {
  const filePath = path.join(root, relativeFile);
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
};

export const extractExpressMounts = (root = defaultRepoRoot) => {
  const source = readRepoText(root, path.join('server', 'index.js'));
  const mounts = new Set();
  const usePattern = /app\.use\('([^']+)'/g;
  const getPattern = /app\.get\('([^']+)'/g;
  for (const pattern of [usePattern, getPattern]) {
    let match = pattern.exec(source);
    while (match) {
      const routePath = match[1];
      if (routePath.startsWith('/api') || routePath.startsWith('/uploads') || routePath.startsWith('/health')) {
        mounts.add(routePath);
      }
      match = pattern.exec(source);
    }
  }
  return Array.from(mounts).sort();
};

export const isFallbackPolicy = (policy) => (
  policy.id.endsWith('fallback')
  || policy.id === 'api-read-fallback'
  || policy.id === 'api-mutation-fallback'
  || policy.id === 'static-fallback'
);

export const mountHasExplicitPolicy = (mount, policies) => policies.some((policy) => {
  if (isFallbackPolicy(policy)) return false;
  if (policy.exactPaths.includes(mount)) return true;
  return policy.pathPrefixes.some((prefix) => (
    mount === prefix
    || mount.startsWith(`${prefix}/`)
    || prefix.startsWith(`${mount}/`)
  ));
});

export const checkPass = ({ id, title, summary, evidence = {}, severity = 'info', scope = 'repo' }) => check({
  id,
  title,
  status: 'pass',
  scope,
  severity,
  summary,
  evidence,
});

export const checkFail = ({ id, title, summary, evidence = {}, severity = 'high', scope = 'repo' }) => check({
  id,
  title,
  status: 'fail',
  scope,
  severity,
  summary,
  evidence,
});

export const checkWarn = ({ id, title, summary, evidence = {}, severity = 'medium', scope = 'repo' }) => check({
  id,
  title,
  status: 'warning',
  scope,
  severity,
  summary,
  evidence,
});
