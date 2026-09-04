import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const reportsDir = path.join(repoRoot, 'security-reports');
mkdirSync(reportsDir, { recursive: true });
const severityOrder = ['low', 'moderate', 'high', 'critical'];
const onlyArg = process.argv.find((entry) => entry.startsWith('--only='));
const onlyWorkspace = String(onlyArg || '').slice('--only='.length).trim();
const auditLevelArg = process.argv.find((entry) => entry.startsWith('--audit-level=')) || '--audit-level=high';
const auditLevel = String(auditLevelArg).slice('--audit-level='.length).trim().toLowerCase();
const omitArg = process.argv.find((entry) => entry.startsWith('--omit='));

if (!severityOrder.includes(auditLevel)) {
  throw new Error(`Unsupported npm audit level: ${auditLevel || '(missing)'}`);
}

if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
  throw new Error('Refusing to run dependency audit with NODE_ENV=production');
}

const availableWorkspaces = [
  { name: 'root', cwd: repoRoot },
  { name: 'app', cwd: path.join(repoRoot, 'app') },
  { name: 'server', cwd: path.join(repoRoot, 'server') },
].filter((workspace) => existsSync(path.join(workspace.cwd, 'package.json')));
const workspaces = availableWorkspaces.filter(
  (workspace) => !onlyWorkspace || workspace.name === onlyWorkspace
);

if (workspaces.length === 0) {
  throw new Error(`Unknown or unavailable npm workspace: ${onlyWorkspace || '(none)'}`);
}

const exceptionPath = path.join(repoRoot, 'security-audit-exceptions.json');
const exceptions = existsSync(exceptionPath)
  ? JSON.parse(readFileSync(exceptionPath, 'utf8')).exceptions || []
  : [];

const extractAdvisoryIds = (value) => [
  ...new Set(String(JSON.stringify(value) || '').match(/GHSA-[a-z0-9-]+/gi) || []),
].map((id) => id.toUpperCase());

const resolveAdvisoryIds = (advisory, vulnerabilities, visited = new Set()) => {
  if (!advisory || visited.has(advisory.name)) return [];
  visited.add(advisory.name);

  const directIds = extractAdvisoryIds(advisory.via);
  const transitiveIds = advisory.via
    .filter((entry) => typeof entry === 'string')
    .flatMap((dependencyName) => resolveAdvisoryIds(
      vulnerabilities.find((candidate) => candidate.name === dependencyName),
      vulnerabilities,
      visited
    ));
  return [...new Set([...directIds, ...transitiveIds])];
};

const isExcepted = ({ workspace, name, severity, ...advisory }, vulnerabilities) => exceptions.some((exception) => {
  if (exception.workspace && exception.workspace !== workspace) return false;
  if (exception.name && exception.name !== name) return false;
  if (exception.severity && String(exception.severity).toLowerCase() !== String(severity).toLowerCase()) return false;
  if (!exception.reason) return false;
  if (!exception.expires) return false;
  const expiration = new Date(exception.expires).getTime();
  if (!Number.isFinite(expiration) || expiration < Date.now()) return false;
  if (!Array.isArray(exception.advisoryIds) || exception.advisoryIds.length === 0) return false;

  const allowedIds = exception.advisoryIds.map((id) => String(id).toUpperCase());
  const observedIds = resolveAdvisoryIds({ workspace, name, severity, ...advisory }, vulnerabilities);
  if (observedIds.length === 0 || observedIds.some((id) => !allowedIds.includes(id))) return false;
  return true;
});

const resolveNpmInvocation = () => {
  if (process.platform !== 'win32') {
    return { command: 'npm', argsPrefix: [] };
  }

  const bundledNpmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const npmCli = [process.env.npm_execpath, bundledNpmCli]
    .filter(Boolean)
    .find((candidate) => existsSync(candidate));

  if (!npmCli) {
    throw new Error('Unable to locate npm-cli.js for shell-free npm audit execution on Windows');
  }

  return { command: process.execPath, argsPrefix: [npmCli] };
};

const npmInvocation = resolveNpmInvocation();
// The registry bulk-advisories endpoint intermittently answers slowly for
// large trees; widen the fetch window so transient slowness does not fail the
// gate. Real findings and persistent network errors still fail closed.
const npmAuditFetchArgs = [
  '--fetch-timeout=600000',
  '--fetch-retries=5',
  '--fetch-retry-mintimeout=20000',
  '--fetch-retry-maxtimeout=120000',
];
const npmAuditArgs = [
  ...npmInvocation.argsPrefix,
  'audit',
  auditLevelArg,
  ...(omitArg ? [omitArg] : []),
  ...npmAuditFetchArgs,
  '--json',
];

const runAudit = ({ name, cwd }) => {
  const result = spawnSync(npmInvocation.command, npmAuditArgs, {
    cwd,
    encoding: 'utf8',
    shell: false,
  });

  let parsed = {};
  try {
    parsed = JSON.parse(result.stdout || '{}');
  } catch {
    parsed = {
      parseError: true,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  const vulnerabilities = Object.entries(parsed.vulnerabilities || {})
    .map(([packageName, advisory]) => ({
      workspace: name,
      name: packageName,
      severity: advisory.severity || 'unknown',
      via: advisory.via || [],
      fixAvailable: advisory.fixAvailable || false,
      range: advisory.range || '',
      nodes: advisory.nodes || [],
    }))
    .filter((advisory) => severityOrder.indexOf(String(advisory.severity).toLowerCase())
      >= severityOrder.indexOf(auditLevel));

  return {
    workspace: name,
    cwd,
    exitCode: result.status,
    error: result.error?.message || '',
    metadata: parsed.metadata || {},
    vulnerabilities,
    raw: parsed,
  };
};

const audits = workspaces.map(runAudit);
const unexcepted = audits.flatMap((audit) => audit.vulnerabilities
  .filter((advisory) => !isExcepted(advisory, audit.vulnerabilities)));
const failedAudits = audits.filter((audit) => audit.error || (audit.exitCode !== 0 && audit.vulnerabilities.length === 0));

const report = {
  generatedAt: new Date().toISOString(),
  command: `npm audit ${omitArg ? `${omitArg} ` : ''}${auditLevelArg} ${npmAuditFetchArgs.join(' ')} --json`,
  exceptionFile: existsSync(exceptionPath) ? 'security-audit-exceptions.json' : null,
  audits,
  auditLevel,
  unexceptedAtOrAboveThreshold: unexcepted,
  unexceptedHighOrCritical: unexcepted.filter((advisory) => (
    ['high', 'critical'].includes(String(advisory.severity).toLowerCase())
  )),
};

writeFileSync(path.join(reportsDir, 'dependency-audit.json'), `${JSON.stringify(report, null, 2)}\n`);

if (failedAudits.length > 0) {
  console.error(`Dependency audit failed to execute for ${failedAudits.length} workspace(s). Report: security-reports/dependency-audit.json`);
  process.exit(1);
}

if (unexcepted.length > 0 || audits.some((audit) => audit.raw.parseError)) {
  console.error(`Dependency audit failed with ${unexcepted.length} unexcepted finding(s) at or above ${auditLevel}. Report: security-reports/dependency-audit.json`);
  process.exit(1);
}

console.log(`Dependency audit passed for ${audits.length} workspace(s) at or above ${auditLevel}.`);
