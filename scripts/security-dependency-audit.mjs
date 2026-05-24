import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const reportsDir = path.join(repoRoot, 'security-reports');
mkdirSync(reportsDir, { recursive: true });

if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production') {
  throw new Error('Refusing to run dependency audit with NODE_ENV=production');
}

const workspaces = [
  { name: 'root', cwd: repoRoot },
  { name: 'app', cwd: path.join(repoRoot, 'app') },
  { name: 'server', cwd: path.join(repoRoot, 'server') },
].filter((workspace) => existsSync(path.join(workspace.cwd, 'package.json')));

const exceptionPath = path.join(repoRoot, 'security-audit-exceptions.json');
const exceptions = existsSync(exceptionPath)
  ? JSON.parse(readFileSync(exceptionPath, 'utf8')).exceptions || []
  : [];

const isExcepted = ({ workspace, name, severity }) => exceptions.some((exception) => {
  if (exception.workspace && exception.workspace !== workspace) return false;
  if (exception.name && exception.name !== name) return false;
  if (exception.severity && exception.severity !== severity) return false;
  if (!exception.reason) return false;
  if (exception.expires && new Date(exception.expires).getTime() < Date.now()) return false;
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

const runAudit = ({ name, cwd }) => {
  const result = spawnSync(npmInvocation.command, [...npmInvocation.argsPrefix, 'audit', '--audit-level=high', '--json'], {
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
    .filter((advisory) => ['high', 'critical'].includes(String(advisory.severity).toLowerCase()));

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
  .filter((advisory) => !isExcepted(advisory)));
const failedAudits = audits.filter((audit) => audit.error || (audit.exitCode !== 0 && audit.vulnerabilities.length === 0));

const report = {
  generatedAt: new Date().toISOString(),
  command: 'npm audit --audit-level=high --json',
  exceptionFile: existsSync(exceptionPath) ? 'security-audit-exceptions.json' : null,
  audits,
  unexceptedHighOrCritical: unexcepted,
};

writeFileSync(path.join(reportsDir, 'dependency-audit.json'), `${JSON.stringify(report, null, 2)}\n`);

if (failedAudits.length > 0) {
  console.error(`Dependency audit failed to execute for ${failedAudits.length} workspace(s). Report: security-reports/dependency-audit.json`);
  process.exit(1);
}

if (unexcepted.length > 0 || audits.some((audit) => audit.raw.parseError)) {
  console.error(`Dependency audit failed with ${unexcepted.length} unexcepted high/critical finding(s). Report: security-reports/dependency-audit.json`);
  process.exit(1);
}

console.log(`Dependency audit passed for ${audits.length} workspace(s).`);
